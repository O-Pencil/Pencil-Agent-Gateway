/**
 * Nano-Pencil Engine Adapter
 *
 * [WHO]  Gateway server — provides NanoPencilEngineAdapter and createNanoPencilAdapter()
 * [FROM] Depends on @pencil-agent/nano-pencil (createAgentSession, ModelRegistry, AuthStorage, SessionManager, silentLogger)
 * [TO]   Consumed by AgentRegistry when binding engines to AgentInstances
 * [HERE] src/engine/nano-adapter.ts — ONLY file in Gateway that imports @pencil-agent/nano-pencil
 *
 * Per-session isolation: each sessionId gets its own AgentSession with private
 * inMemory state, so concurrent HTTP sessions cannot read each other's history.
 *
 * Uses createAgentSession directly (not PencilAgent wrapper) to guarantee the
 * caller-specified model is passed through — PencilAgent silently drops the model
 * parameter and lets the SDK auto-discover from local config, which breaks in
 * Gateway mode where the model comes from the HTTP request.
 */

import {
  createAgentSession,
  ModelRegistry,
  AuthStorage,
  SessionManager,
  silentLogger,
} from '@pencil-agent/nano-pencil';
import type { AgentSession, AgentSessionEvent } from '@pencil-agent/nano-pencil';

import type { EngineAdapter, EngineRunRequest, EngineRunOptions, EngineRunResult } from './adapter.js';
import type { AgentConfig } from '../config.js';
import { logger } from '../util/logger.js';
import { EngineError } from '../util/errors.js';

/**
 * Holds a per-session AgentSession + its event listener state.
 */
interface SessionEntry {
  session: AgentSession;
}

export class NanoPencilEngineAdapter implements EngineAdapter {
  readonly id = 'nano-pencil';

  private provider: string;
  private modelName: string;
  private apiKey?: string;
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private sessions = new Map<string, SessionEntry>();

  constructor(config: AgentConfig) {
    this.provider = config.model.provider;
    this.modelName = config.model.name;
    this.apiKey = config.model.apiKey;

    // Create isolated auth storage (in-memory, no file I/O)
    this.authStorage = AuthStorage.inMemory();
    this.modelRegistry = new ModelRegistry(this.authStorage);

    logger.debug('NanoPencilEngineAdapter created', {
      provider: this.provider,
      model: this.modelName,
    });
  }

  /**
   * Ensure the API key is registered for this provider.
   * Called lazily before each session creation so the key is always fresh.
   */
  private async ensureApiKey(): Promise<void> {
    if (this.apiKey) {
      await this.authStorage.set(this.provider, {
        type: 'api_key',
        key: this.apiKey,
      });
    }
  }

  /**
   * Resolve the Model object from the registry. Throws if not found.
   */
  private resolveModel() {
    const model = this.modelRegistry.find(this.provider, this.modelName);
    if (!model) {
      throw new EngineError(
        `Model '${this.modelName}' not found for provider '${this.provider}'. ` +
        `Check the model name and ensure the provider supports it.`
      );
    }
    return model;
  }

  /**
   * Get or create an AgentSession for the given sessionId.
   */
  private async getOrCreateSession(sessionId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    await this.ensureApiKey();
    const model = this.resolveModel();

    try {
      const { session } = await createAgentSession({
        model,
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        sessionManager: SessionManager.inMemory(),
        enableSoul: false,
        enableMCP: false,
        silent: true,
        logger: silentLogger,
      });

      const entry: SessionEntry = { session };
      this.sessions.set(sessionId, entry);

      logger.debug('AgentSession created', {
        provider: this.provider,
        model: this.modelName,
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
    logger.debug('NanoPencilEngineAdapter.run', {
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

    let collectedText = '';

    const listener = (event: AgentSessionEvent) => {
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const content = event.message.content;
        if (typeof content === 'string') {
          collectedText += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') collectedText += block.text;
          }
        }
      }
    };

    const unsub = session.subscribe(listener);

    try {
      await session.prompt(message);
    } catch (err) {
      throw new EngineError(
        `Engine run failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      unsub();
    }

    if (!collectedText.trim()) {
      throw new EngineError('Engine returned empty response');
    }

    return {
      text: collectedText,
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

    const emitDone = (reason: EngineRunResult['finishReason']) => {
      if (doneEmitted) return;
      doneEmitted = true;
      finishReason = reason;
      options.onDelta!({ type: 'done', finishReason: reason });
    };

    const listener = (event: AgentSessionEvent) => {
      // Text deltas
      if (event.type === 'message_update' && event.message?.role === 'assistant') {
        const ae = event.assistantMessageEvent;
        if (ae?.type === 'text_delta' && 'delta' in ae) {
          const delta = ae.delta as string;
          collectedText += delta;
          options.onDelta!({ type: 'delta', content: delta });
        }
      }

      // Completion
      if (event.type === 'agent_end' || event.type === 'turn_end') {
        emitDone('stop');
      }

      // Errors
      if (event.type === 'sdk:error') {
        const msg = event.error instanceof Error ? event.error.message : String(event.error);
        options.onDelta!({ type: 'error', error: msg });
      }
    };

    const unsub = session.subscribe(listener);

    try {
      await session.prompt(message);

      // Fallback: collect from message_end if no deltas arrived
      if (collectedText === '') {
        emitDone('stop');
      }
    } catch (err) {
      if (options.signal?.aborted) {
        emitDone('cancelled');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Streaming error', {
          agentId: request.agentId,
          sessionId: request.sessionId,
          error: msg,
        });
        options.onDelta!({ type: 'error', error: msg });
        finishReason = 'error';
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
      const entry = this.sessions.get(sessionId);
      if (entry) {
        this.sessions.delete(sessionId);
      }
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
