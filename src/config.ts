/**
 * Pencil Agent Gateway Configuration
 *
 * [WHO]  Gateway server
 * [FROM] Environment variables, config files
 * [TO]  All gateway modules
 * [HERE] Centralized configuration loading with env interpolation
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidRequestError } from './util/errors.js';
import { logger } from './util/logger.js';
import { expandHome, resolveAgainst } from './util/paths.js';
import type { ChannelsConfig } from './channels/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * API Key configuration
 */
export interface ApiKeyConfig {
  key: string;
  label?: string;
  allowedAgents: '*' | string[];
}

/**
 * Single model entry inside ModelConfig.models — used to register custom
 * (non-SDK-built-in) providers like Coding Plan endpoints. Only `id` is
 * required; other fields fall back to nano-pencil ModelRegistry defaults
 * (contextWindow=128000, maxTokens=16384, input=['text']).
 */
export interface ModelDef {
  id: string;
  name?: string;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * Model configuration. All fields optional:
 *   - provider/name: when omitted, the engine adapter falls back to whatever
 *     model the local nano-pencil install (`~/.nanopencil/`) resolves as default.
 *   - apiKey: when present, the adapter creates an isolated in-memory auth
 *     store (BYO key); when absent, it inherits the user's local nano-pencil
 *     auth so provider/model switching happens in the SDK, not the Gateway.
 *   - api/models: when set, the adapter dynamically registers `provider` on
 *     its in-memory ModelRegistry via ModelRegistry.registerProvider(). This
 *     is what lets Coding Plan providers (dashscope-coding, qianfan-coding,
 *     ark-coding, minimax-coding, zhipu-coding) work — they are not in the
 *     SDK's built-in MODELS catalog. If `provider` matches a Gateway preset
 *     (see engine/coding-plan-presets.ts), the preset fills any missing
 *     baseUrl/api/models so callers only need to supply the apiKey.
 */
export interface ModelConfig {
  provider?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Wire-protocol identifier registered in the SDK's api-registry, e.g.
   * 'openai-completions' or 'anthropic-messages'. Combined with `models`
   * to register a custom provider at runtime.
   */
  api?: string;
  /**
   * Model catalog for the provider. When provided, replaces any built-in
   * models for `provider` on the adapter's in-memory ModelRegistry.
   */
  models?: ModelDef[];
}

/**
 * Soul configuration
 */
export interface SoulConfig {
  systemPrompt?: string;
  styleTags?: string[];
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  mode: 'short-term';
  maxTurns: number;
}

/**
 * Engine configuration
 */
export interface EngineConfig {
  type: 'nano-pencil' | string;
  options?: Record<string, unknown>;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  name?: string;
  soul?: SoulConfig;
  memory?: MemoryConfig;
  /**
   * Optional. When omitted, the adapter inherits the user's local nano-pencil
   * install (auth + default model). Provide it to override provider/model or
   * to run in BYO-key mode (see ModelConfig).
   */
  model?: ModelConfig;
  engine?: EngineConfig;
  /**
   * Per-agent nano-pencil install root. Used by NanoPencilEngineAdapter as
   * the agentDir (auth.json, models.json, settings.json, sessions/). Resolved
   * via:
   *   1. this field (after `~` expansion + relative-to-config resolution)
   *   2. process.env.NANOPENCIL_CODING_AGENT_DIR if this field is unset
   *   3. `~/.pencils/<config.id>` as the final fallback
   *
   * Issue 0012: making this explicit lets multiple PencilAgents coexist in a
   * single Gateway process (each with its own agentDir). It also removes the
   * silent "wrong env → wrong persona" footgun that the start-pencil.sh
   * heuristic was patching.
   *
   * Supports `~/` prefix; relative paths resolve against the config file's
   * directory (or process.cwd() when loaded from env-only fallback).
   */
  agentDir?: string;
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  gateway: {
    host: string;
    port: number;
    logLevel: string;
    corsOrigins: string;
    requestTimeoutMs: number;
  };
  apiKeys: ApiKeyConfig[];
  dataDir: string;
  agents: AgentConfig[];
  channels?: ChannelsConfig;
}

/**
 * Interpolate environment variables in a string.
 *
 * Supports two forms (bash-compatible subset):
 *
 *   ${VAR}              hard reference — throws InvalidRequestError if VAR is unset.
 *                       Use for required values (apiKeys, secrets that must be present).
 *
 *   ${VAR:-default}     soft reference — returns `default` if VAR is unset OR empty.
 *                       The default may itself be empty (`${VAR:-}`), which yields ""
 *                       and lets downstream code treat the field as "not configured".
 *                       Use for optional channel features (e.g. AI card template id),
 *                       so a pencil that hasn't enabled DingTalk streaming doesn't
 *                       block Gateway startup.
 *
 * The `:-` form mirrors POSIX shell semantics so ops folks don't need to learn a
 * second syntax. `${VAR-default}` (no colon) is intentionally NOT supported — the
 * distinction between "unset" and "set-but-empty" rarely matters for our config
 * surface and the colon form is the safer default.
 */
export function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const sepIdx = expr.indexOf(':-');
    if (sepIdx >= 0) {
      const name = expr.slice(0, sepIdx).trim();
      const fallback = expr.slice(sepIdx + 2);
      const v = process.env[name];
      return v === undefined || v === '' ? fallback : v;
    }
    const envValue = process.env[expr];
    if (envValue === undefined) {
      throw new InvalidRequestError(`Environment variable ${expr} is not set`);
    }
    return envValue;
  });
}

/**
 * Deep interpolate environment variables in an object
 */
export function deepInterpolateEnv<T>(obj: T): T {
  if (typeof obj === 'string') {
    return interpolateEnv(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepInterpolateEnv) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepInterpolateEnv(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Load and parse a YAML/JSON configuration file
 */
function loadConfigFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new InvalidRequestError(`Configuration file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  // Try to parse as JSON first
  try {
    return JSON.parse(content);
  } catch {
    // If not JSON, assume YAML (simplified - will add yaml parser later)
    // For now, we'll use a simple YAML parser or assume JSON
    // In a real implementation, we'd add `js-yaml` as a dependency
    throw new InvalidRequestError(
      `Configuration file must be JSON format. ${filePath} is not valid JSON`
    );
  }
}

/**
 * Load gateway configuration from file or environment.
 *
 * Failure semantics (issue 0010):
 *   - When the caller passed an explicit `configPath` OR `GATEWAY_CONFIG` is
 *     set, any load/parse failure is **fatal** — silent fallback hides
 *     operator typos that turn the gateway into "401 to everything".
 *   - Only when the implicit default path (`config/default.json`) is missing
 *     do we fall back to env-only. The fallback honors `API_KEY` so you can
 *     bring up a smoke instance with a single env var.
 */
export function loadConfig(configPath?: string): GatewayConfig {
  const defaultConfigPath = resolve(__dirname, '../config/default.json');
  const explicitlyRequested = !!configPath || !!process.env.GATEWAY_CONFIG;
  const configFilePath = configPath
    ? resolve(configPath)
    : process.env.GATEWAY_CONFIG || defaultConfigPath;

  logger.info('Loading configuration', { path: configFilePath, explicit: explicitlyRequested });

  let rawConfig: unknown;
  try {
    if (existsSync(configFilePath) && configFilePath.endsWith('.yaml')) {
      throw new InvalidRequestError(
        'YAML support requires js-yaml dependency. Using default.json instead.'
      );
    }
    rawConfig = loadConfigFile(configFilePath);
  } catch (err) {
    if (explicitlyRequested) {
      // Don't degrade silently when the operator explicitly picked a path.
      throw new InvalidRequestError(
        `Failed to load configuration at ${configFilePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    logger.warn(
      'No config file found at default path, falling back to env-only configuration',
      { defaultPath: configFilePath },
    );
    const envApiKey = process.env.API_KEY;
    rawConfig = {
      gateway: {
        host: process.env.HOST || '0.0.0.0',
        port: parseInt(process.env.PORT || '8080', 10),
        logLevel: process.env.LOG_LEVEL || 'info',
        corsOrigins: process.env.CORS_ORIGINS || '*',
        requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10),
      },
      apiKeys: envApiKey
        ? [{ key: envApiKey, label: 'env-API_KEY', allowedAgents: '*' }]
        : [],
      dataDir: process.env.DATA_DIR || './data',
      agents: [],
    };
    if (!envApiKey) {
      logger.warn(
        'env-only fallback produced zero API keys — server will refuse to start ' +
          'unless API_KEY env is set or GATEWAY_ALLOW_NO_AUTH=1.',
      );
    }
  }

  // Interpolate environment variables
  const config = deepInterpolateEnv(rawConfig) as GatewayConfig;

  // Validate required fields
  if (!config.gateway) {
    throw new InvalidRequestError('Missing "gateway" section in configuration');
  }
  if (!config.apiKeys) {
    throw new InvalidRequestError('Missing "apiKeys" section in configuration');
  }

  // Validate gateway settings
  if (typeof config.gateway.port !== 'number' || config.gateway.port <= 0) {
    throw new InvalidRequestError('Invalid port number in configuration');
  }
  if (config.apiKeys.length === 0) {
    logger.warn('No API keys configured. At least one API key is recommended.');
  }

  // Issue 0012 — `dataDir` and per-agent `agentDir` resolution.
  //
  // Why this lives here instead of "wherever it gets used":
  //   Both fields are user-facing config knobs that mean different things at
  //   different layers (Gateway registry persistence vs. nano-pencil engine
  //   state). Resolving them once at load time gives every consumer the same
  //   absolute path and removes the cwd / config-relative ambiguity that the
  //   start-pencil.sh heuristic was patching.
  //
  //   Resolution rules:
  //     - `~/` prefix → user home (cross-platform)
  //     - Relative paths → resolved against the directory containing the
  //       config file. Loading via env-only fallback uses cwd as base.
  //     - Default `dataDir`        → `~/.pencils/gateway` (issue 0012 plan A:
  //       gateway state + nano-pencil agent state under the same `~/.pencils`
  //       tree, distinct subfolders).
  //     - Default agent `agentDir` → `~/.pencils/<config.id>` so a given
  //       PencilAgent's gateway+CLI state share the same folder name.
  //   Env-var fallback for agentDir keeps the legacy
  //   `NANOPENCIL_CODING_AGENT_DIR` path working when set; once set on the
  //   AgentConfig, the env var is no longer consulted for that agent.
  const configBaseDir = existsSync(configFilePath) ? dirname(configFilePath) : process.cwd();
  const defaultDataDir = join(homedir(), '.pencils', 'gateway');
  const rawDataDir = config.dataDir ?? defaultDataDir;
  config.dataDir = resolveAgainst(configBaseDir, rawDataDir);

  for (const agent of config.agents ?? []) {
    if (!agent.id) continue;
    const explicit = agent.agentDir?.trim();
    const fromEnv = process.env.NANOPENCIL_CODING_AGENT_DIR?.trim();
    const resolved = explicit
      ? resolveAgainst(configBaseDir, explicit)
      : fromEnv
        ? expandHome(fromEnv)
        : join(homedir(), '.pencils', agent.id);
    agent.agentDir = resolved;
  }

  logger.info('Configuration loaded successfully', {
    host: config.gateway.host,
    port: config.gateway.port,
    logLevel: config.gateway.logLevel,
    dataDir: config.dataDir,
    apiKeysCount: config.apiKeys.length,
    agents: config.agents?.map((a) => ({ id: a.id, agentDir: a.agentDir })) ?? [],
  });

  return config;
}

/**
 * Current configuration (set after load)
 */
let currentConfig: GatewayConfig | null = null;

/**
 * Get the current configuration
 */
export function getConfig(): GatewayConfig {
  if (!currentConfig) {
    throw new InvalidRequestError('Configuration not loaded. Call loadConfig() first.');
  }
  return currentConfig;
}

/**
 * Set the current configuration
 */
export function setConfig(config: GatewayConfig): void {
  currentConfig = config;
}

/**
 * Check if configuration is ready (for /readyz endpoint)
 */
export function isConfigReady(): boolean {
  return currentConfig !== null;
}
