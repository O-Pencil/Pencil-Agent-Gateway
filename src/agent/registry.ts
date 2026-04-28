/**
 * Pencil Agent Registry
 *
 * [WHO]  Gateway server
 * [FROM] API handlers, config loader
 * [TO]  Engine adapters, /v1/models endpoint
 * [HERE] Agent instance management and persistence
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentConfig } from '../config.js';
import { InvalidRequestError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { type EngineAdapter } from '../engine/adapter.js';
import { createNanoPencilAdapter } from '../engine/nano-adapter.js';

interface DisposableEngine extends EngineAdapter {
  dispose?: () => Promise<void> | void;
}

/**
 * Agent instance (runtime representation)
 */
export class AgentInstance {
  readonly id: string;
  readonly name: string;
  readonly config: AgentConfig;
  readonly modelId: string;
  readonly engine: EngineAdapter;
  createdAt: number;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.config = config;
    this.modelId = `pencil/${config.id}`;
    this.createdAt = Date.now();

    // Bind the appropriate engine adapter based on config
    const engineType = config.engine?.type || 'nano-pencil';
    if (engineType === 'nano-pencil') {
      this.engine = createNanoPencilAdapter(config);
    } else {
      // Default to nano-pencil for unknown engine types in v0.1
      logger.warn(`Unknown engine type '${engineType}', falling back to nano-pencil`, {
        agentId: config.id,
      });
      this.engine = createNanoPencilAdapter(config);
    }
  }

  /**
   * Convert to OpenAI model format
   */
  toModel() {
    return {
      id: this.modelId,
      object: 'model' as const,
      created: Math.floor(this.createdAt / 1000),
      owned_by: 'pencil-agent-gateway',
    };
  }

  /**
   * Convert to response format (excluding sensitive data)
   */
  toResponse() {
    return {
      id: this.id,
      modelId: this.modelId,
      name: this.name,
      engine: this.config.engine?.type || 'nano-pencil',
      memory: this.config.memory || { mode: 'short-term', maxTurns: 20 },
    };
  }

  /**
   * Release resources held by this instance's engine.
   * Safe to call multiple times.
   */
  async dispose(): Promise<void> {
    const disposable = this.engine as DisposableEngine;
    if (typeof disposable.dispose !== 'function') return;
    try {
      await disposable.dispose();
    } catch (err) {
      logger.warn('Engine dispose threw', {
        agentId: this.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Agent registry manages all agent instances
 */
export class AgentRegistry {
  private instances = new Map<string, AgentInstance>();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    // Ensure data directory exists
    const agentsDir = join(dataDir, 'agents');
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }
  }

  /**
   * Load agents from directory
   */
  async load(): Promise<void> {
    const agentsDir = join(this.dataDir, 'agents');
    if (!existsSync(agentsDir)) {
      logger.info('No agents directory found, starting empty');
      return;
    }

    logger.info('Loading agents from directory', { path: agentsDir });

    // For MVP, read JSON files
    // In future, this could support multiple formats
    try {
      const files = readdirSync(agentsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(agentsDir, file);
          const content = readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content) as AgentConfig;
          await this.register(config);
          logger.info('Loaded agent from file', { id: config.id, file });
        }
      }
    } catch (err) {
      logger.warn('Failed to load some agents', { error: err });
    }
  }

  /**
   * Register a new agent instance.
   *
   * If an instance already exists for `config.id`, its engine is disposed
   * before being replaced — otherwise per-session PencilAgent state from
   * the old instance leaks (issue 0007).
   */
  async register(config: AgentConfig): Promise<AgentInstance> {
    const previous = this.instances.get(config.id);
    if (previous) {
      logger.debug('Replacing existing agent — disposing old engine', { id: config.id });
      await previous.dispose();
    }
    const instance = new AgentInstance(config);
    this.instances.set(config.id, instance);
    this.persist(config);
    logger.info('Agent registered', {
      id: config.id,
      modelId: instance.modelId,
      replaced: !!previous,
    });
    return instance;
  }

  /**
   * Get agent instance by ID
   */
  get(id: string): AgentInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Get agent instance by model ID (pencil/<id>)
   */
  getByModelId(modelId: string): AgentInstance | undefined {
    if (!modelId.startsWith('pencil/')) {
      return undefined;
    }
    const id = modelId.replace('pencil/', '');
    return this.instances.get(id);
  }

  /**
   * Check if agent exists
   */
  has(id: string): boolean {
    return this.instances.has(id);
  }

  /**
   * Check if model ID exists
   */
  hasModelId(modelId: string): boolean {
    if (!modelId.startsWith('pencil/')) {
      return false;
    }
    const id = modelId.replace('pencil/', '');
    return this.instances.has(id);
  }

  /**
   * Get all agent instances
   */
  getAll(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get all model IDs in OpenAI format
   */
  getModels() {
    return this.getAll().map((agent) => agent.toModel());
  }

  /**
   * Delete an agent instance and dispose its engine.
   */
  async delete(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) return false;
    await instance.dispose();
    this.instances.delete(id);
    const filePath = join(this.dataDir, 'agents', `${id}.json`);
    try {
      unlinkSync(filePath);
      logger.info('Agent deleted', { id });
    } catch {
      // File might not exist, that's okay
    }
    return true;
  }

  /**
   * Dispose every registered agent's engine (issue 0008).
   * Used during graceful shutdown. Errors per-instance are logged but never
   * thrown — graceful shutdown must not be blocked by a single bad engine.
   */
  async disposeAll(): Promise<void> {
    const ids = Array.from(this.instances.keys());
    logger.info('Disposing all agents', { count: ids.length });
    await Promise.all(ids.map(async (id) => {
      const instance = this.instances.get(id);
      if (instance) await instance.dispose();
    }));
    this.instances.clear();
  }

  /**
   * Persist agent configuration to file
   */
  private persist(config: AgentConfig): void {
    const filePath = join(this.dataDir, 'agents', `${config.id}.json`);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Load agents from config (initial setup)
   */
  async loadFromConfig(agentsConfig: AgentConfig[]): Promise<void> {
    for (const config of agentsConfig) {
      if (!config.id) {
        logger.warn('Skipping agent config without id');
        continue;
      }
      await this.register(config);
    }
  }
}

// Global registry instance
let registry: AgentRegistry | null = null;

/**
 * Get or create the global registry
 */
export function getRegistry(): AgentRegistry {
  if (!registry) {
    throw new InvalidRequestError('Registry not initialized. Call initRegistry() first.');
  }
  return registry;
}

/**
 * Initialize the registry with data directory
 */
export function initRegistry(dataDir: string): AgentRegistry {
  registry = new AgentRegistry(dataDir);
  return registry;
}
