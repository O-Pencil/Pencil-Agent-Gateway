/**
 * Coding Plan Provider Presets — Gateway-self-maintained
 *
 * [WHO]  Provides CODING_PLAN_PRESETS map and getCodingPlanPreset() helper
 * [FROM] No external dependencies (pure data)
 * [TO]   Consumed by src/engine/nano-adapter.ts when registering custom
 *        providers on the per-agent in-memory ModelRegistry
 * [HERE] src/engine/coding-plan-presets.ts
 *
 * Why this exists:
 *
 * The nanoPencil CLI's TUI shows providers like `dashscope-coding`,
 * `qianfan-coding`, `ark-coding`, `minimax-coding`, `zhipu-coding` — but
 * those providers are NOT in the SDK's built-in MODELS catalog. They live in
 * `nanopencil-defaults.ts`'s NANOPENCIL_DEFAULT_MODELS_JSON, which the CLI
 * seeds into ~/.nanopencil/agent/models.json on startup. The SDK only
 * supplies the underlying API protocols (openai-completions / anthropic-
 * messages / ...); the Coding Plan "providers" are CLI ergonomics on top.
 *
 * The Gateway runs in environments without that ~/.nanopencil seed (Docker
 * containers, Render deploys, etc.), so we mirror the same preset table
 * here. The adapter calls registerProvider() on its in-memory registry with
 * these defaults, letting Asgard users pick a Coding Plan provider in the
 * UI by name and only supply an apiKey.
 *
 * KEEP IN SYNC with @pencil-agent/nano-pencil's NANOPENCIL_DEFAULT_MODELS_JSON
 * (see nanoPencil/nanopencil-defaults.ts). Until that constant is exported
 * from the package's main barrel, this is a manual mirror; review on every
 * nano-pencil version bump.
 *
 * Constraint: additive-only. Never remove a provider from this map without
 * coordinating with the CLI side — existing PencilAgent configurations may
 * reference these IDs.
 */

export interface CodingPlanModelDef {
  id: string;
  name: string;
  input: ('text' | 'image')[];
  contextWindow: number;
  maxTokens: number;
}

export interface CodingPlanPreset {
  baseUrl: string;
  api: string;
  models: CodingPlanModelDef[];
}

/**
 * Provider name → preset config. Keys must match what Asgard sends as
 * `model.provider` on the agent definition. Values mirror the upstream
 * NANOPENCIL_DEFAULT_MODELS_JSON entries.
 */
export const CODING_PLAN_PRESETS: Record<string, CodingPlanPreset> = {
  'dashscope-coding': {
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', input: ['text', 'image'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', input: ['text', 'image'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'qwen3-max-2026-01-23', name: 'Qwen3 Max', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', input: ['text'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', input: ['text'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'glm-5', name: 'GLM-5', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'glm-4.7', name: 'GLM-4.7', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', input: ['text', 'image'], contextWindow: 262144, maxTokens: 32768 },
    ],
  },

  'minimax-coding': {
    baseUrl: 'https://api.minimaxi.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', input: ['text'], contextWindow: 204800, maxTokens: 65536 },
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', input: ['text'], contextWindow: 204800, maxTokens: 65536 },
      { id: 'MiniMax-M2.1', name: 'MiniMax M2.1', input: ['text'], contextWindow: 204800, maxTokens: 65536 },
      { id: 'MiniMax-M2', name: 'MiniMax M2', input: ['text'], contextWindow: 204800, maxTokens: 65536 },
    ],
  },

  'zhipu-coding': {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    models: [
      { id: 'glm-5', name: 'GLM-5', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'glm-4.7', name: 'GLM-4.7', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
    ],
  },

  'qianfan-coding': {
    baseUrl: 'https://qianfan.baidubce.com/v2/coding',
    api: 'openai-completions',
    models: [
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (Qianfan)', input: ['text', 'image'], contextWindow: 262144, maxTokens: 32768 },
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (Qianfan)', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'glm-5', name: 'GLM-5 (Qianfan)', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5 (Qianfan)', input: ['text'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'glm-4.7', name: 'GLM-4.7 (Qianfan)', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1 (Qianfan)', input: ['text'], contextWindow: 1000000, maxTokens: 65536 },
    ],
  },

  'ark-coding': {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    api: 'openai-completions',
    models: [
      { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code (Ark)', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro (Ark)', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite (Ark)', input: ['text'], contextWindow: 262144, maxTokens: 32768 },
      { id: 'doubao-seed-code', name: 'Doubao Seed Code (Ark)', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'minimax-m2.5', name: 'MiniMax M2.5 (Ark)', input: ['text'], contextWindow: 1000000, maxTokens: 65536 },
      { id: 'glm-4.7', name: 'GLM-4.7 (Ark)', input: ['text'], contextWindow: 202752, maxTokens: 16384 },
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (Ark)', input: ['text'], contextWindow: 262144, maxTokens: 65536 },
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (Ark)', input: ['text', 'image'], contextWindow: 262144, maxTokens: 32768 },
    ],
  },

  'anthropic-custom': {
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', input: ['text', 'image'], contextWindow: 200000, maxTokens: 16384 },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', input: ['text', 'image'], contextWindow: 200000, maxTokens: 32000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', input: ['text', 'image'], contextWindow: 200000, maxTokens: 8192 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', input: ['text', 'image'], contextWindow: 200000, maxTokens: 8192 },
    ],
  },
};

/** Look up a preset by provider name. Returns undefined if not in the table. */
export function getCodingPlanPreset(provider?: string): CodingPlanPreset | undefined {
  if (!provider) return undefined;
  return CODING_PLAN_PRESETS[provider];
}

/** List of provider IDs available as presets. Useful for UI / discovery. */
export function listCodingPlanProviders(): string[] {
  return Object.keys(CODING_PLAN_PRESETS);
}
