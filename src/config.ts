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
 * Model configuration
 */
export interface ModelConfig {
  provider: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
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
  model: ModelConfig;
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
 * Load gateway configuration from file or environment
 */
export function loadConfig(configPath?: string): GatewayConfig {
  // Determine config file path
  const defaultConfigPath = resolve(__dirname, '../config/default.json');
  const configFilePath = configPath
    ? resolve(configPath)
    : process.env.GATEWAY_CONFIG || defaultConfigPath;

  logger.info('Loading configuration', { path: configFilePath });

  // Load and parse config file
  let rawConfig: unknown;
  try {
    // For MVP, try to read as JSON
    if (existsSync(configFilePath) && configFilePath.endsWith('.yaml')) {
      // YAML support would need js-yaml dependency
      throw new InvalidRequestError(
        'YAML support requires js-yaml dependency. Using default.json instead.'
      );
    }
    rawConfig = loadConfigFile(configFilePath);
  } catch (err) {
    // If file loading fails, use default config with env vars
    logger.warn('Failed to load config file, using defaults', { error: err });
    rawConfig = {
      gateway: {
        host: process.env.HOST || '0.0.0.0',
        port: parseInt(process.env.PORT || '8080', 10),
        logLevel: process.env.LOG_LEVEL || 'info',
        corsOrigins: process.env.CORS_ORIGINS || '*',
        requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10),
      },
      apiKeys: [],
      dataDir: process.env.DATA_DIR || './data',
      agents: [],
    };
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
