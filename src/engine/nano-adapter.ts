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
 *
 * Completion is read from `agent_end` (authoritative final state), not
 * `message_end` — the SDK's inner agent.js catches model-call errors and emits
 * them as `agent_end` with `messages[].errorMessage` set, *without* firing a
 * `message_end`. Listening only on `message_end` therefore gives the caller a
 * misleading "empty response" instead of the actual failure (bad model, bad
 * key, rate limit, etc.).
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

interface SessionEntry {
  session: AgentSession;
}

/**
 * Pull the final assistant text out of an `agent_end` event payload.
 * Returns `null` if there is no assistant message in the payload.
 */
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

/**
 * Pull `errorMessage` off the last assistant message in an `agent_end` payload.
 */
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

    this.authStorage = AuthStorage.inMemory();
    this.modelRegistry = new ModelRegistry(this.authStorage);

    logger.debug('NanoPencilEngineAdapter created', {
      provider: this.provider,
      model: this.modelName,
    });
  }

  private async ensureApiKey(): Promise<void> {
    if (this.apiKey) {
      await this.authStorage.set(this.provider, {
        type: 'api_key',
        key: this.apiKey,
      });
    }
  }

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
      throw new EngineError(
        `Engine run failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      unsub();
    }

    if (agentEndError) {
      throw new EngineError(`Engine reported error: ${agentEndError}`);
    }
    if (sdkError && finalText === null) {
      throw new EngineError(`Engine SDK error: ${sdkError}`);
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

      // Incremental text deltas
      if (event.type === 'message_update' && event.message?.role === 'assistant') {
        const ae = event.assistantMessageEvent;
        if (ae?.type === 'text_delta' && 'delta' in ae) {
          const delta = ae.delta as string;
          collectedText += delta;
          options.onDelta!({ type: 'delta', content: delta });
        }
      }

      // Authoritative completion / error event
      if (event.type === 'agent_end') {
        const err = extractErrorMessage(event.messages);
        if (err) {
          emitError(`Engine reported error: ${err}`);
          emitDone('error');
          return;
        }
        // If the SDK never streamed deltas, fall back to one-shot delta from the
        // final assistant text so the client sees something.
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
        emitError(`Engine SDK error: ${msg}`);
      }
    };

    const unsub = session.subscribe(listener);

    try {
      await session.prompt(message);
      // Defensive: prompt resolved but no agent_end fired
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
        logger.error('Streaming error', {
          agentId: request.agentId,
          sessionId: request.sessionId,
          error: msg,
        });
        emitError(`Engine run failed: ${msg}`);
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
