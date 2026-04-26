/**
 * Nano-Pencil Engine Adapter
 *
 * [WHO]  Gateway server — provides NanoPencilEngineAdapter and createNanoPencilAdapter()
 * [FROM] Depends on @pencil-agent/nano-pencil (PencilAgent, ModelRegistry, AuthStorage, silentLogger)
 * [TO]   Consumed by AgentRegistry when binding engines to AgentInstances
 * [HERE] src/engine/nano-adapter.ts — ONLY file in Gateway that imports @pencil-agent/nano-pencil
 *
 * Per-session PencilAgent isolation: each unique sessionId gets its own
 * PencilAgent instance with private inMemory state, so concurrent HTTP sessions
 * cannot read each other's conversation history.
 */

import { PencilAgent, ModelRegistry, AuthStorage, silentLogger } from '@pencil-agent/nano-pencil';
import type { AgentSessionEvent } from '@pencil-agent/nano-pencil';

import type { EngineAdapter, EngineRunRequest, EngineRunOptions, EngineRunResult } from './adapter.js';
import type { AgentConfig } from '../config.js';
import { logger } from '../util/logger.js';
import { EngineError } from '../util/errors.js';

/**
 * Nano-Pencil Engine Adapter
 *
 * Bridges the Gateway EngineAdapter interface to the @pencil-agent/nano-pencil SDK.
 * Each adapter wraps one AgentConfig and maintains a Map<sessionId, PencilAgent>
 * so each conversation gets its own isolated PencilAgent state.
 */
export class NanoPencilEngineAdapter implements EngineAdapter {
  readonly id = 'nano-pencil';

  private modelRegistry: ModelRegistry;
  private provider: string;
  private modelName: string;
  private apiKey?: string;
  private sessions = new Map<string, PencilAgent>();

  constructor(config: AgentConfig) {
    this.provider = config.model.provider;
    this.modelName = config.model.name;
    this.apiKey = config.model.apiKey;

    // Initialize auth storage and model registry for model resolution
    const authStorage = AuthStorage.inMemory();
    this.modelRegistry = new ModelRegistry(authStorage);

    if (this.apiKey) {
      authStorage.set(this.provider, { type: 'api_key', key: this.apiKey });
    }

    logger.debug('NanoPencilEngineAdapter created', {
      provider: this.provider,
      model: this.modelName,
    });
  }

  /**
   * Resolve the Model object from the registry to validate it exists.
   * Throws if the model cannot be found.
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
   * Get or create a PencilAgent for the given session.
   * Each sessionId gets its own PencilAgent with private inMemory state.
   */
  private async getOrCreateAgent(sessionId: string): Promise<PencilAgent> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const agent = new PencilAgent({
      apiKey: this.apiKey,
      provider: this.provider,
      model: this.modelName,
      silent: true,
      inMemory: true,
      tools: [],
      logger: silentLogger,
    });

    try {
      await agent.init();
    } catch (err) {
      throw new EngineError(
        `Failed to initialize PencilAgent for session '${sessionId}': ` +
          (err instanceof Error ? err.message : String(err)),
        err,
      );
    }

    this.sessions.set(sessionId, agent);
    logger.debug('PencilAgent session created', {
      provider: this.provider,
      model: this.modelName,
      sessionId,
      activeSessions: this.sessions.size,
    });
    return agent;
  }

  /**
   * Run the engine and generate a response.
   *
   * For non-streaming: uses PencilAgent.run() which blocks until completion.
   * For streaming: uses PencilAgent.prompt() + subscribe() for event-driven deltas.
   */
  async run(request: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult> {
    logger.debug('NanoPencilEngineAdapter.run', {
      agentId: request.agentId,
      sessionId: request.sessionId,
      messageCount: request.messages.length,
      stream: options?.stream ?? false,
    });

    // Validate model before initializing
    this.resolveModel();

    const agent = await this.getOrCreateAgent(request.sessionId);

    if (options?.stream && options.onDelta) {
      return this.runStreaming(agent, request, options);
    }

    return this.runNonStreaming(agent, request);
  }

  /**
   * Non-streaming execution: use PencilAgent.run() which blocks until completion.
   */
  private async runNonStreaming(agent: PencilAgent, request: EngineRunRequest): Promise<EngineRunResult> {
    const message = this.buildUserMessage(request);

    try {
      const text = await agent.run(message);

      return {
        text,
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        `Engine run failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /**
   * Streaming execution: use PencilAgent.prompt() + subscribe() for event-driven deltas.
   */
  private async runStreaming(
    agent: PencilAgent,
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
      // Collect text deltas from message_update events
      if (event.type === 'message_update' && event.message?.role === 'assistant') {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type === 'text_delta' && 'delta' in assistantEvent) {
          const delta = assistantEvent.delta as string;
          collectedText += delta;
          options.onDelta!({ type: 'delta', content: delta });
        }
      }

      // Detect completion
      if (event.type === 'agent_end' || event.type === 'turn_end') {
        emitDone('stop');
      }

      // Handle SDK errors
      if (event.type === 'sdk:error') {
        const errorMsg = event.error instanceof Error ? event.error.message : String(event.error);
        options.onDelta!({ type: 'error', error: errorMsg });
      }
    };

    agent.subscribe(listener);

    try {
      await agent.prompt(message);

      // Fallback: if no deltas were emitted, use the collected text from getLastText()
      if (collectedText === '' && agent.getLastText()) {
        collectedText = agent.getLastText();
        options.onDelta!({ type: 'delta', content: collectedText });
        emitDone('stop');
      }
    } catch (err) {
      if (options.signal?.aborted) {
        emitDone('cancelled');
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('Streaming error', {
          agentId: request.agentId,
          sessionId: request.sessionId,
          error: errorMsg,
        });
        options.onDelta!({ type: 'error', error: errorMsg });
        finishReason = 'error';
      }
    } finally {
      agent.unsubscribe(listener);
    }

    return {
      text: collectedText,
      finishReason,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  /**
   * Build a user message string from the request messages.
   *
   * In v0.1, only the latest user message is forwarded to PencilAgent.
   * Conversation history is owned by PencilAgent itself (per-session inMemory),
   * so the gateway does not replay prior turns into the engine.
   */
  private buildUserMessage(request: EngineRunRequest): string {
    const userMessages = request.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      throw new EngineError('No user message found in request');
    }
    return userMessages[userMessages.length - 1].content;
  }

  /**
   * Reset a session (or all sessions) to an empty conversation.
   */
  async reset(sessionId?: string): Promise<void> {
    if (sessionId) {
      const agent = this.sessions.get(sessionId);
      if (agent && agent.isInitialized()) {
        await agent.reset();
      }
      return;
    }
    for (const agent of this.sessions.values()) {
      if (agent.isInitialized()) {
        await agent.reset();
      }
    }
  }

  /**
   * Drop a single session and shut down its PencilAgent.
   */
  async dropSession(sessionId: string): Promise<void> {
    const agent = this.sessions.get(sessionId);
    if (!agent) return;
    this.sessions.delete(sessionId);
    if (agent.isInitialized()) {
      try {
        await agent.shutdown();
      } catch (err) {
        logger.warn('Failed to shutdown PencilAgent session', { sessionId, error: err });
      }
    }
  }

  /**
   * Clean up all per-session PencilAgent instances.
   */
  async dispose(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.dropSession(sessionId);
    }
  }

  /** Number of active per-session PencilAgent instances. (Test/diagnostic helper.) */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

/**
 * Factory function to create a NanoPencilEngineAdapter from AgentConfig.
 */
export function createNanoPencilAdapter(config: AgentConfig): NanoPencilEngineAdapter {
  return new NanoPencilEngineAdapter(config);
}
