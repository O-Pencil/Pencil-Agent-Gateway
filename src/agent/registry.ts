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
import { homedir } from 'node:os';
import type { AgentConfig } from '../config.js';
import { InvalidRequestError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { type EngineAdapter } from '../engine/adapter.js';
import { createNanoPencilAdapter } from '../engine/nano-adapter.js';

/**
 * Agent ID must be an ASCII slug: lowercase alphanumeric start, [a-z0-9._-],
 * length 1–64. Used as filesystem directory name, Gateway route modelId,
 * and Asgard cross-system key. displayName handles human-readable names.
 *
 * See nanoPencil/docs/multi-agent-fs-design.md §4.1.
 */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function validateAgentId(id: string): void {
  if (!AGENT_ID_RE.test(id)) {
    throw new InvalidRequestError(
      `Invalid agent id '${id}'. Must match /^[a-z0-9][a-z0-9._-]{0,63}$/. ` +
      `Use ASCII slug for id; Chinese/emoji names go in the 'name' field.`,
    );
  }
}

interface DisposableEngine extends EngineAdapter {
  dispose?: () => Promise<void> | void;
}

/**
 * Agent instance (runtime representation)
 */
export class AgentInstance {
  readonly id: string;
  readonly modelId: string;
  readonly engine: EngineAdapter;
  readonly createdAt: number;

  // Mutable: PUT /v1/agents/:id rewrites these without re-creating the
  // instance, so existing engine sessions stay alive.
  name: string;
  config: AgentConfig;
  updatedAt: number;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.config = config;
    this.modelId = `pencil/${config.id}`;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;

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
      hasSoul: !!this.config.soul?.systemPrompt,
      // Surface the resolved agentDir so operators can confirm multi-pencil
      // isolation works (each instance points at its own ~/.pencils/<id>/).
      // Sensitive only insofar as it's a filesystem path; not auth material.
      agentDir: this.config.agentDir,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Apply a config update in place. Existing engine sessions keep their
   * captured Soul/model — that is the point of update-vs-replace; updating
   * Soul should not destroy a user's running conversation. New sessions
   * created after this call use the new config.
   */
  applyUpdate(config: AgentConfig): void {
    this.config = config;
    this.name = config.name || config.id;
    this.updatedAt = Date.now();
    const reconfigurable = this.engine as EngineAdapter & {
      reconfigure?: (c: AgentConfig) => void;
    };
    if (typeof reconfigurable.reconfigure === 'function') {
      reconfigurable.reconfigure(config);
    } else {
      logger.warn('Engine does not support reconfigure(); update applied at instance level only', {
        id: this.id,
      });
    }
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
          try {
            await this.register(config);
            logger.info('Loaded agent from file', { id: config.id, file });
          } catch (err) {
            logger.error('Skipping invalid agent config', {
              file,
              id: config.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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
    validateAgentId(config.id);
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
   * Update an existing agent's configuration without disposing its engine.
   *
   * Differs from `register()` (POST semantics): keeps in-memory sessions and
   * conversation history. Sessions created before this call retain their
   * original Soul/model; new sessions see the new config. This is the right
   * semantics for "user tweaks Soul prompt" — you don't want their open chat
   * to lose history every time they nudge the prompt.
   *
   * Throws if the agent does not exist; callers (e.g. PUT route) should use
   * 404 in that case.
   */
  async update(id: string, config: AgentConfig): Promise<AgentInstance> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new InvalidRequestError(`Agent '${id}' not found — use POST to create`);
    }
    if (config.id && config.id !== id) {
      throw new InvalidRequestError(
        `Path id '${id}' does not match body id '${config.id}'; agent ids are immutable`,
      );
    }
    const merged: AgentConfig = { ...config, id };
    instance.applyUpdate(merged);
    this.persist(merged);
    logger.info('Agent updated', { id, hasSoul: !!merged.soul?.systemPrompt });
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

    // G3 (doc 16 §11.2.1): write the agent's canonical metadata under
    // <agentDir>/agent.json so that nanoPencil CLI / future agent.json
    // readers (e.g. `pencils ls`) can discover this Agent without going
    // through Gateway's registry. The agentDir path resolution mirrors
    // nano-adapter constructor: explicit config.agentDir wins, otherwise
    // default to ~/.pencils/agents/<id>/.
    //
    // This is best-effort — a failure here doesn't roll back the registry
    // write because the registry is the load-bearing record and agent.json
    // is metadata for cross-tool interop.
    try {
      this.writeAgentMetadata(config);
    } catch (err) {
      logger.warn('Failed to write agent.json metadata (registry persist OK)', {
        id: config.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Write <agentDir>/agent.json per doc 16 §11.2.1 schema.
   *
   * Fields:
   *   - id / displayName / description — for human / UI / nanoPencil ls
   *   - createdAt / updatedAt — lifecycle
   *   - origin.type — `local` (Gateway-created) or `cloud-adopted` (future,
   *     when adopt flow is in)
   *   - kind — placeholder for the super/derived/custom classification
   *     (doc 16 §13.x design; defaults to `custom` if unset, see roadmap P1)
   *   - engine — 'nano-pencil' as today
   *
   * Idempotent: re-writing an existing file with the same id is fine.
   * `createdAt` is only set on first write (preserved on subsequent updates).
   */
  private writeAgentMetadata(config: AgentConfig): void {
    const agentDir =
      config.agentDir ?? join(homedir(), '.pencils', 'agents', config.id);
    mkdirSync(agentDir, { recursive: true });

    const metadataPath = join(agentDir, 'agent.json');
    const now = new Date().toISOString();

    let createdAt = now;
    if (existsSync(metadataPath)) {
      try {
        const existing = JSON.parse(readFileSync(metadataPath, 'utf-8'));
        if (typeof existing.createdAt === 'string') {
          createdAt = existing.createdAt;
        }
      } catch {
        // corrupt file; overwrite with fresh metadata
      }
    }

    const metadata = {
      version: '1.0.0',
      id: config.id,
      displayName: config.name ?? config.id,
      createdAt,
      updatedAt: now,
      // P0: default to 'custom' until Asgard schema delivers a kind field
      // (roadmap P1). SuperAgent / DerivedAgent classification + soul_policy
      // enforcement come in P1–P3.
      kind: 'custom',
      origin: { type: 'local' },
      engine: config.engine?.type ?? 'nano-pencil',
      extensions: {},
    };

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
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
      try {
        await this.register(config);
      } catch (err) {
        logger.error('Skipping invalid agent config', {
          id: config.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
