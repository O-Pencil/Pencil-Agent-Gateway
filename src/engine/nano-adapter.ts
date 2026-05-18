/**
 * Nano-Pencil Engine Adapter
 *
 * [WHO]  Gateway server — provides NanoPencilEngineAdapter and createNanoPencilAdapter()
 * [FROM] Depends on @pencil-agent/nano-pencil (createAgentSession, ModelRegistry, AuthStorage, SessionManager, getAgentDir, silentLogger)
 * [TO]   Consumed by AgentRegistry when binding engines to AgentInstances
 * [HERE] src/engine/nano-adapter.ts — ONLY file in Gateway that imports @pencil-agent/nano-pencil
 *
 * Two operating modes, selected per-agent:
 *
 *   1. **Inherited** (no `model.apiKey`): defer to the user's local nano-pencil
 *      install — `~/.nanopencil/auth.json` for credentials, settings/registry
 *      for the default model. Provider/model switching is the SDK's job; the
 *      Gateway is just a thin HTTP shell. This is the default smoke path.
 *
 *   2. **BYO key** (`model.apiKey` present): the adapter spins up an isolated,
 *      in-memory AuthStorage seeded with the supplied key. Useful for
 *      multi-tenant deployments where each agent carries its own provider
 *      credential and we cannot read the host's `~/.nanopencil/`.
 *
 * Per-session isolation: in either mode, each `sessionId` gets its own
 * `AgentSession` with private inMemory state, so concurrent HTTP sessions
 * cannot read each other's history.
 *
 * Completion is read from `agent_end` (authoritative final state). The SDK's
 * inner agent.js catches model-call errors and emits them as `agent_end` with
 * `messages[].errorMessage` set, *without* firing `message_end` — listening
 * only on `message_end` therefore yields a misleading "empty response" instead
 * of the actual failure (bad model, bad key, rate limit, etc.).
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  createAgentSession,
  ModelRegistry,
  AuthStorage,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  silentLogger,
} from '@pencil-agent/nano-pencil';
import type { AgentSession, AgentSessionEvent } from '@pencil-agent/nano-pencil';

import type { EngineAdapter, EngineRunRequest, EngineRunOptions, EngineRunResult } from './adapter.js';
import type { AgentConfig, ModelDef } from '../config.js';
import { logger } from '../util/logger.js';
import { EngineError } from '../util/errors.js';
import { getCodingPlanPreset, type CodingPlanModelDef } from './coding-plan-presets.js';

/**
 * Provider IDs whose `apiKey` lives in `auth.json` rather than `models.json`.
 * Mirrors the `allowOptionalApiKeyForProvider` list nanopencil's CLI passes
 * when it constructs its ModelRegistry (see nano-pencil dist/main.js). Without
 * this whitelist, ModelRegistry's schema validator rejects every coding-plan
 * provider in the user's models.json, silently dropping them and producing
 * "No model selected" at chat time.
 *
 * Keep in sync with nanopencil's NANOPENCIL_*_PROVIDER constants. We hardcode
 * the strings instead of importing them because they are part of the CLI
 * package's private surface, not the SDK's public exports.
 */
const NANOPENCIL_OPTIONAL_API_KEY_PROVIDERS: string[] = [
  'dashscope-coding',
  'ali-token-plan-openai',
  'qianfan-coding',
  'ark-coding',
  'minimax-coding',
  'zhipu-coding',
  'anthropic-custom',
  'ollama',
  'openrouter',
  'custom-anthropic',
  'custom-openai',
];

/**
 * System-level security guardrails (P0 security requirement).
 * Appended to every Agent's Soul prompt to ensure consistent refusal of
 * sensitive internal information regardless of user-defined personality.
 */
const SAFETY_GUARDRAIL = `
[Security Guardrail / 安全约束]
- 涉及到 API Key / 密钥 / 凭证 / 账号密码 / 内部配置的问题都不能回答 (Do not answer questions about API keys, secrets, credentials, passwords, accounts, or internal configurations).
- 涉及到平台内部部署、IP、端口、服务器配置的问题不能回答 (Do not answer questions about internal deployment, IP addresses, ports, or server configurations).
- 涉及到其他用户的信息不能回答 (Do not answer questions about other users' information).
`.trim();

interface SessionEntry {
  session: AgentSession;
}

type AdapterMode = 'byo-key' | 'inherited';

function providerEnvApiKey(provider?: string): string | undefined {
  if (!provider) return undefined;
  const normalized = provider.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const candidates = [
    `${normalized.toUpperCase()}_API_KEY`,
    provider.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY',
  ];
  if (normalized === 'gemini') candidates.push('GOOGLE_API_KEY');
  // Same DashScope Coding endpoint as dashscope-coding; users often only have
  // DASHSCOPE_API_KEY in the environment.
  if (normalized === 'ali_token_plan_openai') {
    candidates.push('DASHSCOPE_API_KEY');
    candidates.push('DASHSCOPE_CODING_API_KEY');
  }
  for (const name of candidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function composeSoulPrompt(config: AgentConfig): string | undefined {
  const sys = config.soul?.systemPrompt?.trim();
  const tags = config.soul?.styleTags?.filter(t => typeof t === 'string' && t.trim().length > 0);

  // Empty Soul must still ship the guardrail. Without this branch, returning
  // undefined here causes nano-pencil SDK to fall back to its own hardcoded
  // default system prompt (the "writing assistant in nanopencil" string) and
  // the entire safety constraint is silently bypassed for any agent created
  // without a Soul — direct CLI / config-file registrations, or future
  // Asgard flows that allow Soul-less agents.
  if (!sys) return SAFETY_GUARDRAIL;

  let prompt = sys;
  if (tags && tags.length > 0) {
    // Style tags ride along as a hint; we don't try to be clever about
    // formatting. Asgard owns the prompt template, this only joins them.
    prompt = `${sys}\n\n[style: ${tags.join(', ')}]`;
  }

  return `${prompt}\n\n${SAFETY_GUARDRAIL}`;
}

function extractAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== 'assistant') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      let out = '';
      for (const block of m.content as Array<{ type?: string; text?: string }>) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          out += block.text;
        }
      }
      return out;
    }
  }
  return null;
}

function extractErrorMessage(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; errorMessage?: string; stopReason?: string };
    if (m?.role !== 'assistant') continue;
    if (typeof m.errorMessage === 'string' && m.errorMessage.length > 0) return m.errorMessage;
    if (m.stopReason === 'error') return 'Engine reported stopReason=error without an errorMessage';
    return null;
  }
  return null;
}

/**
 * Resolve provider config (baseUrl + api + models[]) by merging the agent's
 * ModelConfig with any matching Gateway preset. Caller-supplied fields win.
 *
 * Returns null when there's not enough data to register the provider —
 * e.g. user only supplied a provider name that's not in our presets and
 * didn't fill in baseUrl/api/models. In that case we fall through to the
 * SDK's built-in MODELS lookup (which works for `anthropic`, `openai`, etc.).
 */
function resolveCustomProviderConfig(
  provider: string,
  modelConfig: { baseUrl?: string; api?: string; models?: ModelDef[] } | undefined,
): { baseUrl: string; api: string; models: CodingPlanModelDef[] } | null {
  const preset = getCodingPlanPreset(provider);
  const baseUrl = modelConfig?.baseUrl ?? preset?.baseUrl;
  const api = modelConfig?.api ?? preset?.api;
  // User-supplied models[] fully replaces preset models[] when both are set.
  const userModels = modelConfig?.models;
  let models: CodingPlanModelDef[] | undefined;
  if (userModels && userModels.length > 0) {
    models = userModels.map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      input: m.input ?? ['text'],
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 16384,
    }));
  } else {
    models = preset?.models;
  }
  if (!baseUrl || !api || !models || models.length === 0) return null;
  return { baseUrl, api, models };
}

export class NanoPencilEngineAdapter implements EngineAdapter {
  readonly id = 'nano-pencil';

  // Effectively-immutable per session creation, but `reconfigure()` can swap
  // them in place so PUT /v1/agents/:id can update Soul/model without throwing
  // away running conversations.
  private mode: AdapterMode;
  private provider?: string;
  private modelName?: string;
  private apiKey?: string;
  // Custom-provider extension fields (see ModelConfig in src/config.ts). Used
  // alongside the Coding Plan preset table to register OpenAI/Anthropic-compat
  // endpoints that aren't in the SDK's built-in MODELS catalog.
  private modelBaseUrl?: string;
  private modelApi?: string;
  private modelDefs?: ModelDef[];
  /**
   * Soul prompt — what makes a PencilAgent "this Agent" rather than a generic
   * model call. Composed from soul.systemPrompt + (optional) styleTags hint
   * so the same field on AgentConfig is both human-readable and effective.
   * Plumbed through DefaultResourceLoader.systemPrompt; nano-pencil's runtime
   * uses that as the top-level system message.
   */
  private soulPrompt?: string;
  /**
   * Memory window from AgentConfig.memory.maxTurns. nano-pencil's session
   * accumulates conversation history without a turn-count cap (only token
   * compaction). To honor the configured value we enforce a *rolling* cap:
   * once the captured AgentSession's message count exceeds the budget, the
   * session entry is dropped and the next prompt creates a fresh one.
   * That trades long-tail history for predictable, configurable memory —
   * appropriate for the "short-term" memory mode this config exposes.
   */
  private memoryMaxTurns?: number;
  /**
   * Per-instance nano-pencil agentDir. Resolved at construction so that two
   * AgentInstances on the same Gateway process can each point at their own
   * `~/.pencils/<id>/` (auth.json, models.json, settings.json). Defaults to
   * the SDK's process-global getAgentDir() when the operator didn't override
   * it via AgentConfig.agentDir. See issue 0012 for context.
   */
  private agentDir: string;
  private sessions = new Map<string, SessionEntry>();

  // Lazy: only allocated for byo-key mode.
  private byoAuthStorage?: AuthStorage;
  private byoModelRegistry?: ModelRegistry;
  private byoKeyApplied = false;

  constructor(config: AgentConfig) {
    this.provider = config.model?.provider;
    this.modelName = config.model?.name;
    this.apiKey = config.model?.apiKey ?? providerEnvApiKey(this.provider);
    this.modelBaseUrl = config.model?.baseUrl;
    this.modelApi = config.model?.api;
    this.modelDefs = config.model?.models;
    this.mode = this.apiKey ? 'byo-key' : 'inherited';
    this.soulPrompt = composeSoulPrompt(config);
    this.memoryMaxTurns = config.memory?.maxTurns;
    // P0 (doc 16 §9.3): every Agent gets its own ~/.pencils/agents/<id>/
    // slot. config.agentDir from loadConfig() already resolves to an absolute
    // path for config-declared agents. Runtime POSTs (Asgard sync, /v1/agents)
    // skip loadConfig() so we derive a per-id default here — NOT the SDK's
    // process-global getAgentDir() which would make every Asgard agent share
    // one mind dir.
    this.agentDir = config.agentDir ?? join(homedir(), '.pencils', 'agents', config.id);

    logger.debug('NanoPencilEngineAdapter created', {
      mode: this.mode,
      provider: this.provider,
      model: this.modelName,
      hasSoul: !!this.soulPrompt,
      memoryMaxTurns: this.memoryMaxTurns,
      agentDir: this.agentDir,
    });
  }

  /**
   * Update which Soul / provider / model future sessions will be built with.
   * Existing sessions keep their captured config — that is the point of this
   * method (avoid blowing away conversation history on PUT).
   *
   * If the BYO-key fingerprint changes (provider or apiKey), the BYO auth
   * cache is invalidated so the next session creation re-applies it.
   */
  reconfigure(config: AgentConfig): void {
    const prevMode = this.mode;
    const prevProvider = this.provider;
    const prevApiKey = this.apiKey;
    const prevBaseUrl = this.modelBaseUrl;
    const prevApi = this.modelApi;
    const prevModelDefs = this.modelDefs;

    this.provider = config.model?.provider;
    this.modelName = config.model?.name;
    this.apiKey = config.model?.apiKey ?? providerEnvApiKey(this.provider);
    this.modelBaseUrl = config.model?.baseUrl;
    this.modelApi = config.model?.api;
    this.modelDefs = config.model?.models;
    this.mode = this.apiKey ? 'byo-key' : 'inherited';
    this.soulPrompt = composeSoulPrompt(config);
    this.memoryMaxTurns = config.memory?.maxTurns;
    // agentDir change is treated as a credential change below — switching
    // <agentDir>/auth.json swaps the entire credential surface, so any cached
    // BYO registry built against the old dir would be stale.
    const prevAgentDir = this.agentDir;
    this.agentDir =
      config.agentDir ?? join(homedir(), '.pencils', 'agents', config.id);

    // Custom-provider config changes invalidate the BYO registry too — the
    // registered baseUrl / model list are baked into the in-memory registry,
    // so we must rebuild it next session.
    const customConfigChanged =
      prevBaseUrl !== this.modelBaseUrl ||
      prevApi !== this.modelApi ||
      prevModelDefs !== this.modelDefs;
    const credentialChanged =
      prevMode !== this.mode ||
      prevProvider !== this.provider ||
      prevApiKey !== this.apiKey ||
      prevAgentDir !== this.agentDir ||
      customConfigChanged;
    if (credentialChanged) {
      this.byoAuthStorage = undefined;
      this.byoModelRegistry = undefined;
      this.byoKeyApplied = false;
    }

    logger.debug('NanoPencilEngineAdapter reconfigured', {
      mode: this.mode,
      provider: this.provider,
      model: this.modelName,
      hasSoul: !!this.soulPrompt,
      retainedSessions: this.sessions.size,
      credentialChanged,
    });
  }

  /**
   * Build the createAgentSession options for the current request, lazily
   * allocating any per-mode resources (auth/registry) the first time they are
   * needed.
   */
  private async buildSessionOptions(sessionId: string) {
    const opts: Parameters<typeof createAgentSession>[0] = {
      // Always pin agentDir explicitly. Without it the SDK passes `undefined`
      // to AuthStorage.create()/new ModelRegistry(), which collapses to the
      // built-in defaults — bypassing the user's custom providers in
      // <agentDir>/models.json (e.g. minimax-coding, dashscope-coding,
      // qianfan-coding). That makes every "inherited mode + settings-derived
      // model" request fail with "No model selected" even when settings.json
      // and auth.json are correct. Pinning agentDir here keeps the BYO-key
      // and explicit-provider branches' behaviour, and gives the implicit
      // branch the same view the local nanopencil CLI sees.
      agentDir: this.agentDir,
      // P0.5 (doc 16 §10.4): pin cwd to the agent's own dir so the SDK's
      // DefaultResourceLoader doesn't fall through to `process.cwd()` and
      // pick up the Gateway *repo*'s AGENTS.md/CLAUDE.md as "project
      // context", polluting every Agent's system prompt with the wrong
      // identity. With cwd === agentDir, only the agent's own .PENCIL.md
      // (if any) gets loaded, which is the correct per-agent scope for a
      // headless HTTP gateway.
      cwd: this.agentDir,
      enableSoul: false,
      enableMCP: false,
      silent: true,
      logger: silentLogger,
      sessionManager: SessionManager.inMemory(),
    };

    // Soul injection. Build a resource loader that returns our composed system
    // prompt. enableSoul stays false because the SDK's "Soul" feature is the
    // personality-evolution system, not the same thing as Gateway's
    // soul.systemPrompt — we only need the system-prompt slot.
    //
    // P0.5: must explicitly `await loader.reload()` here. The SDK only auto-
    // reloads when it constructs its OWN DefaultResourceLoader (sdk.ts:307);
    // when we pass an external loader, our `systemPrompt` field stays in
    // `systemPromptSource` until reload() copies it to `systemPrompt`. Without
    // reload, `getSystemPrompt()` returns undefined, agent-session falls back
    // to the SDK's hard-coded "You are the writing assistant in nanopencil…"
    // base template — completely overriding our Soul. The visible symptom:
    // every Asgard-created Agent introduces itself as "nanopencil writing
    // assistant" regardless of its configured Soul.
    if (this.soulPrompt) {
      const loader = new DefaultResourceLoader({
        agentDir: this.agentDir,
        // Pin cwd to the agent's own dir so loadProjectContextFiles() doesn't
        // walk back to process.cwd() and pull in the Gateway repo's
        // AGENTS.md/CLAUDE.md as "project context" for every agent.
        cwd: this.agentDir,
        systemPrompt: this.soulPrompt,
        // Skip filesystem discovery of skills/prompts/themes — Gateway agents
        // are headless. Without these flags the loader scans ~/.nanopencil and
        // cwd for resources we'd never use.
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await loader.reload();
      opts.resourceLoader = loader;
    }

    if (this.mode === 'byo-key') {
      // Allocate isolated in-memory auth on first use.
      if (!this.byoAuthStorage) {
        this.byoAuthStorage = AuthStorage.inMemory();
        this.byoModelRegistry = new ModelRegistry(this.byoAuthStorage);
      }
      // Refresh credential each session creation in case it rotated.
      if (!this.byoKeyApplied) {
        if (!this.provider) {
          throw new EngineError(
            'BYO-key mode requires model.provider in agent config (we need to know which provider to attach the key to).',
          );
        }
        await this.byoAuthStorage.set(this.provider, {
          type: 'api_key',
          key: this.apiKey!,
        });
        this.byoKeyApplied = true;
      }

      // Two paths to a usable Model<Api>:
      //   1. provider is in the SDK's built-in MODELS catalog (anthropic,
      //      openai, google, ...) — `find()` succeeds out of the box.
      //   2. provider is a Coding Plan / custom endpoint not in MODELS —
      //      we register it on the in-memory registry from a Gateway preset
      //      and/or user-supplied baseUrl/api/models[], then `find()` again.
      let resolvedModelName = this.modelName;
      let model = resolvedModelName
        ? this.byoModelRegistry!.find(this.provider!, resolvedModelName)
        : undefined;

      if (!model) {
        const customCfg = resolveCustomProviderConfig(this.provider!, {
          baseUrl: this.modelBaseUrl,
          api: this.modelApi,
          models: this.modelDefs,
        });

        if (customCfg) {
          // registerProvider() does a full replacement of any existing models
          // for `provider`, so we only call it for non-built-in providers
          // (the find() above already handled built-in hits).
          this.byoModelRegistry!.registerProvider(this.provider!, {
            baseUrl: customCfg.baseUrl,
            api: customCfg.api as never, // Api is `KnownApi | (string & {})` — accept any string
            apiKey: this.apiKey!,
            models: customCfg.models.map(m => ({
              id: m.id,
              name: m.name,
              reasoning: false,
              input: m.input,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
            })),
          });

          // If the caller didn't pin a model id, default to the first one in
          // the preset/custom list. This matches CLI behaviour where the user
          // picks from a TUI list, and lets Asgard's "create with provider
          // only" flow work without a follow-up.
          if (!resolvedModelName) {
            resolvedModelName = customCfg.models[0].id;
          }

          model = this.byoModelRegistry!.find(this.provider!, resolvedModelName);
        }
      }

      if (!model) {
        throw new EngineError(
          `Model '${this.modelName ?? '(unspecified)'}' not found for provider '${this.provider}'. ` +
            'Either pick a model id known to the SDK\'s built-in catalog, supply ' +
            'model.api + model.models[] in the agent config, or use one of the ' +
            'Gateway Coding Plan presets (dashscope-coding, qianfan-coding, ' +
            'ark-coding, minimax-coding, zhipu-coding, anthropic-custom).',
        );
      }

      opts.model = model;
      opts.authStorage = this.byoAuthStorage;
      opts.modelRegistry = this.byoModelRegistry;
      logger.debug('AgentSession options (byo-key)', {
        sessionId,
        provider: this.provider,
        model: resolvedModelName,
      });
      return opts;
    }

    // ── inherited mode ───────────────────────────────────
    // Defer to the user's nanopencil install at <agentDir>. We always build
    // the local AuthStorage + ModelRegistry ourselves rather than letting
    // createAgentSession default-construct them, because:
    //
    //   1. The SDK's default `new ModelRegistry(authStorage, modelsPath)`
    //      omits `allowOptionalApiKeyForProvider`. That makes ModelRegistry's
    //      schema validator reject every coding-plan provider in the user's
    //      models.json (dashscope-coding, minimax-coding, qianfan-coding,
    //      ark-coding, zhipu-coding, ...) because their apiKey lives in
    //      auth.json, not models.json. Result: the registry silently throws
    //      away the entire models.json and findInitialModel() returns
    //      undefined, so chat fails with "No model selected" even when the
    //      user's settings + auth are fine. nanopencil CLI's main.ts allows
    //      these providers to skip the apiKey requirement; we mirror that
    //      list here so Gateway sees the same registry the CLI sees.
    //
    //   2. With the registry in hand we can resolve the model deterministically
    //      from settings.json (defaultProvider + defaultModel) when the agent
    //      config didn't pin a provider/name. This mirrors how the CLI resolves
    //      its startup model and surfaces clear errors when settings are
    //      incomplete, instead of bubbling up an unhelpful "No model selected".
    //
    // agentDir is per-instance (issue 0012); two pencils on the same Gateway
    // process can each point at their own ~/.pencils/<id>/ tree.
    const agentDir = this.agentDir;
    // AuthStorage.create() expects the path to auth.json itself, NOT the
    // agentDir. Passing the directory makes FileAuthStorageBackend treat the
    // dir as a file, silently ending up with an empty storage and surfacing
    // as "No API key found for <provider>" at chat time.
    const localAuth = AuthStorage.create(join(agentDir, 'auth.json'));
    // ModelRegistry signature is (authStorage, modelsJsonPath?, options?).
    // Passing undefined for modelsJsonPath makes it default to
    // join(getAgentDir(), 'models.json') — same file we want — but we name it
    // explicitly here so a future agentDir-override doesn't drift.
    const localRegistry = new ModelRegistry(localAuth, join(agentDir, 'models.json'), {
      allowOptionalApiKeyForProvider: NANOPENCIL_OPTIONAL_API_KEY_PROVIDERS,
    });

    let resolvedProvider = this.provider;
    let resolvedModelName = this.modelName;

    if (!resolvedProvider || !resolvedModelName) {
      const settings = SettingsManager.create(process.cwd(), agentDir);
      resolvedProvider = resolvedProvider ?? settings.getDefaultProvider();
      resolvedModelName = resolvedModelName ?? settings.getDefaultModel();
    }

    if (!resolvedProvider || !resolvedModelName) {
      throw new EngineError(
        `Local nano-pencil install at '${agentDir}' has no defaultProvider/defaultModel in settings.json. ` +
          `Run \`NANOPENCIL_CODING_AGENT_DIR="${agentDir}" nanopencil\` and pick a model with /model, ` +
          'or pin model.provider + model.name in the agent config.',
      );
    }

    let model = localRegistry.find(resolvedProvider, resolvedModelName);

    // Newer Coding Plan provider ids (e.g. ali-token-plan-openai) may exist in
    // Gateway presets before the local ~/.pencils/.../models.json seed from the
    // CLI includes them. If we have a preset + an API key (env or auth.json),
    // register the provider on the same file-backed registry the inherited path
    // already uses, then resolve again.
    if (!model) {
      const customCfg = resolveCustomProviderConfig(resolvedProvider, {
        baseUrl: this.modelBaseUrl,
        api: this.modelApi,
        models: this.modelDefs,
      });
      const cred = localAuth.get(resolvedProvider);
      const apiKeyFromFile = cred?.type === 'api_key' ? cred.key : undefined;
      const codingAlias =
        resolvedProvider === 'ali-token-plan-openai'
          ? localAuth.get('dashscope-coding')
          : undefined;
      const apiKeyFromAlias =
        codingAlias?.type === 'api_key' ? codingAlias.key : undefined;
      let effectiveKey =
        providerEnvApiKey(resolvedProvider) ?? apiKeyFromFile ?? apiKeyFromAlias;
      // OAuth / token-refresh (e.g. ali-token-plan-openai): sync get() misses it; getApiKey() matches CLI.
      if (!effectiveKey && (cred?.type === 'oauth' || !cred)) {
        effectiveKey = (await localAuth.getApiKey(resolvedProvider)) ?? undefined;
      }
      if (!effectiveKey && resolvedProvider === 'ali-token-plan-openai' && !cred) {
        effectiveKey = (await localAuth.getApiKey('dashscope-coding')) ?? undefined;
      }

      if (customCfg && effectiveKey && customCfg.models.some(m => m.id === resolvedModelName)) {
        localRegistry.registerProvider(resolvedProvider, {
          baseUrl: customCfg.baseUrl,
          api: customCfg.api as never,
          apiKey: effectiveKey,
          models: customCfg.models.map(m => ({
            id: m.id,
            name: m.name,
            reasoning: false,
            input: m.input,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
          })),
        });
        model = localRegistry.find(resolvedProvider, resolvedModelName);
      }
    }

    if (!model) {
      const registryError = localRegistry.getError();
      throw new EngineError(
        `Model '${resolvedModelName}' not found for provider '${resolvedProvider}' in the local nano-pencil registry at '${agentDir}'.` +
          (registryError ? `\n\nmodels.json load error: ${registryError}` : '') +
          '\n\nVerify the provider exists in <agentDir>/models.json and the auth.json key for it is set (`/login`).',
      );
    }

    opts.model = model;
    opts.authStorage = localAuth;
    opts.modelRegistry = localRegistry;

    logger.debug('AgentSession options (inherited)', {
      sessionId,
      agentDir,
      provider: resolvedProvider,
      model: resolvedModelName,
      sourcedFromSettings: !this.provider || !this.modelName,
    });
    return opts;
  }

  /**
   * Compute the rolling memory budget. One turn ~ user + assistant message,
   * with a small buffer for system prompt + interleaved tool messages.
   */
  private memoryBudget(): number | null {
    if (!this.memoryMaxTurns || this.memoryMaxTurns <= 0) return null;
    return this.memoryMaxTurns * 2 + 4;
  }

  /**
   * Drop the session entry for `sessionId` if its captured AgentSession has
   * grown past the configured memory budget. Called at the start of each run
   * so the next message starts a fresh conversation when the user has
   * "forgotten" past the maxTurns horizon.
   */
  private rollSessionIfOverBudget(sessionId: string): void {
    const budget = this.memoryBudget();
    if (budget === null) return;
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const messageCount = entry.session.messages.length;
    if (messageCount > budget) {
      logger.info('Memory window exceeded — rolling session', {
        sessionId,
        maxTurns: this.memoryMaxTurns,
        messageCount,
        budget,
      });
      this.sessions.delete(sessionId);
    }
  }

  private async getOrCreateSession(sessionId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const opts = await this.buildSessionOptions(sessionId);

    try {
      const { session } = await createAgentSession(opts);
      const entry: SessionEntry = { session };
      this.sessions.set(sessionId, entry);
      logger.debug('AgentSession created', {
        mode: this.mode,
        sessionId,
        activeSessions: this.sessions.size,
      });
      return entry;
    } catch (err) {
      throw new EngineError(
        `Failed to create AgentSession for '${sessionId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // ── EngineAdapter interface ─────────────────────────────

  async run(request: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult> {
    // nano-pencil's runtime decides temperature/max_tokens at the model level;
    // there's no per-prompt knob. We accept these for OpenAI compatibility but
    // signal the no-op so callers don't quietly assume they took effect.
    if (request.options?.temperature !== undefined || request.options?.maxTokens !== undefined) {
      logger.debug('temperature/max_tokens received but not propagated (nano-pencil has no per-prompt override)', {
        agentId: request.agentId,
        temperature: request.options?.temperature,
        maxTokens: request.options?.maxTokens,
      });
    }

    // Apply memory.maxTurns: drop session if its captured history is past
    // the budget — getOrCreateSession below will then build a fresh one.
    this.rollSessionIfOverBudget(request.sessionId);

    logger.debug('NanoPencilEngineAdapter.run', {
      mode: this.mode,
      agentId: request.agentId,
      sessionId: request.sessionId,
      messageCount: request.messages.length,
      stream: options?.stream ?? false,
    });

    const entry = await this.getOrCreateSession(request.sessionId);

    if (options?.stream && options.onDelta) {
      return this.runStreaming(entry.session, request, options);
    }
    return this.runNonStreaming(entry.session, request);
  }

  // ── Non-streaming ───────────────────────────────────────

  private async runNonStreaming(
    session: AgentSession,
    request: EngineRunRequest,
  ): Promise<EngineRunResult> {
    const message = this.buildUserMessage(request);

    let finalText: string | null = null;
    let agentEndError: string | null = null;
    let sdkError: string | null = null;

    const listener = (event: AgentSessionEvent) => {
      logger.debug('SDK event', { sessionId: request.sessionId, type: event.type });

      if (event.type === 'agent_end') {
        const err = extractErrorMessage(event.messages);
        if (err) {
          agentEndError = err;
        } else {
          const text = extractAssistantText(event.messages);
          if (text !== null) finalText = text;
        }
      } else if (event.type === 'sdk:error') {
        sdkError = event.error instanceof Error ? event.error.message : String(event.error);
      }
    };

    const unsub = session.subscribe(listener);

    try {
      await session.prompt(message);
    } catch (err) {
      // Pass upstream error message verbatim — the engine's own diagnostic
      // (e.g. "429 week allocated quota exceeded") is already specific enough
      // for the client. EngineError.code='engine_error' identifies the layer.
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Engine prompt threw', {
        agentId: request.agentId,
        sessionId: request.sessionId,
        error: msg,
      });
      throw new EngineError(msg, err);
    } finally {
      unsub();
    }

    if (agentEndError) {
      logger.warn('Engine reported error in agent_end', {
        agentId: request.agentId,
        sessionId: request.sessionId,
        error: agentEndError,
      });
      throw new EngineError(agentEndError);
    }
    if (sdkError && finalText === null) {
      logger.warn('Engine SDK error without final text', {
        agentId: request.agentId,
        sessionId: request.sessionId,
        error: sdkError,
      });
      throw new EngineError(sdkError);
    }
    if (finalText === null) {
      throw new EngineError(
        'Engine completed without emitting an agent_end event ' +
          '(no assistant message and no error reported). ' +
          'Enable LOG_LEVEL=debug to see the raw SDK event stream.',
      );
    }

    return {
      text: finalText,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  // ── Streaming ───────────────────────────────────────────

  private async runStreaming(
    session: AgentSession,
    request: EngineRunRequest,
    options: EngineRunOptions,
  ): Promise<EngineRunResult> {
    const message = this.buildUserMessage(request);
    let collectedText = '';
    let finishReason: EngineRunResult['finishReason'] = 'stop';
    let doneEmitted = false;
    let errorReported = false;

    const emitDone = (reason: EngineRunResult['finishReason']) => {
      if (doneEmitted) return;
      doneEmitted = true;
      finishReason = reason;
      options.onDelta!({ type: 'done', finishReason: reason });
    };

    const emitError = (msg: string) => {
      errorReported = true;
      options.onDelta!({ type: 'error', error: msg });
    };

    const listener = (event: AgentSessionEvent) => {
      logger.debug('SDK event', { sessionId: request.sessionId, type: event.type });

      if (event.type === 'message_update' && event.message?.role === 'assistant') {
        const ae = event.assistantMessageEvent;
        if (ae?.type === 'text_delta' && 'delta' in ae) {
          const delta = ae.delta as string;
          collectedText += delta;
          options.onDelta!({ type: 'delta', content: delta });
        }
      }

      if (event.type === 'agent_end') {
        const err = extractErrorMessage(event.messages);
        if (err) {
          logger.warn('Engine reported error in agent_end (streaming)', {
            agentId: request.agentId,
            sessionId: request.sessionId,
            error: err,
          });
          emitError(err);
          emitDone('error');
          return;
        }
        if (collectedText === '') {
          const text = extractAssistantText(event.messages);
          if (text !== null && text.length > 0) {
            collectedText = text;
            options.onDelta!({ type: 'delta', content: text });
          }
        }
        emitDone('stop');
        return;
      }

      if (event.type === 'sdk:error') {
        const msg = event.error instanceof Error ? event.error.message : String(event.error);
        logger.warn('SDK-level error event (streaming)', {
          agentId: request.agentId,
          sessionId: request.sessionId,
          error: msg,
        });
        emitError(msg);
      }
    };

    const unsub = session.subscribe(listener);

    try {
      await session.prompt(message);
      if (!doneEmitted) {
        if (!errorReported && collectedText === '') {
          emitError(
            'Engine completed without emitting an agent_end event ' +
              '(no assistant message and no error reported). ' +
              'Enable LOG_LEVEL=debug to see the raw SDK event stream.',
          );
        }
        emitDone(errorReported ? 'error' : 'stop');
      }
    } catch (err) {
      if (options.signal?.aborted) {
        emitDone('cancelled');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Streaming run threw', {
          agentId: request.agentId,
          sessionId: request.sessionId,
          error: msg,
        });
        emitError(msg);
        emitDone('error');
      }
    } finally {
      unsub();
    }

    return {
      text: collectedText,
      finishReason,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private buildUserMessage(request: EngineRunRequest): string {
    const userMessages = request.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      throw new EngineError('No user message found in request');
    }
    return userMessages[userMessages.length - 1].content;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async reset(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.sessions.delete(sessionId);
      return;
    }
    this.sessions.clear();
  }

  async dropSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

export function createNanoPencilAdapter(config: AgentConfig): NanoPencilEngineAdapter {
  return new NanoPencilEngineAdapter(config);
}
