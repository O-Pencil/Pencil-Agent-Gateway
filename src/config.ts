/**
 * Pencil Agent Gateway Configuration
 *
 * [WHO]  Gateway server
 * [FROM] Environment variables, config files
 * [TO]  All gateway modules
 * [HERE] Centralized configuration loading with env interpolation
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidRequestError } from './util/errors.js';
import { logger } from './util/logger.js';
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
 * Interpolate environment variables in a string
 * Supports ${VAR} syntax
 */
export function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, envVar) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      throw new InvalidRequestError(`Environment variable ${envVar} is not set`);
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

  logger.info('Configuration loaded successfully', {
    host: config.gateway.host,
    port: config.gateway.port,
    logLevel: config.gateway.logLevel,
    dataDir: config.dataDir,
    apiKeysCount: config.apiKeys.length,
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
