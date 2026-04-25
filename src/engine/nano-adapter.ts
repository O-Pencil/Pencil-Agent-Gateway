/**
 * Nano-Pencil Engine Adapter
 *
 * [WHO]  Gateway server — provides NanoPencilEngineAdapter and createNanoPencilAdapter()
 * [FROM] Depends on @pencil-agent/nano-pencil (PencilAgent, ModelRegistry, AuthStorage, silentLogger)
 * [TO]   Consumed by AgentRegistry when binding engines to AgentInstances
 * [HERE] src/engine/nano-adapter.ts — ONLY file in Gateway that imports @pencil-agent/nano-pencil
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
 * Each adapter instance wraps one PencilAgent with a specific model configuration.
 */
export class NanoPencilEngineAdapter implements EngineAdapter {
  readonly id = 'nano-pencil';

  private agent: PencilAgent;
  private modelRegistry: ModelRegistry;
  private provider: string;
  private modelName: string;
  private apiKey?: string;

  constructor(config: AgentConfig) {
    this.provider = config.model.provider;
    this.modelName = config.model.name;
    this.apiKey = config.model.apiKey;

    // Initialize auth storage and model registry for model resolution
    const authStorage = AuthStorage.inMemory();
    this.modelRegistry = new ModelRegistry(authStorage);

    // Set API key if provided
    if (this.apiKey) {
      // Sync set is sufficient for in-memory storage
      authStorage.set(this.provider, { type: 'api_key', key: this.apiKey });
    }

    // Create PencilAgent instance (lazy init)
    this.agent = new PencilAgent({
      apiKey: this.apiKey,
      provider: this.provider,
      model: this.modelName,
      silent: true,
      inMemory: true,
      tools: [], // No tools in v0.1 chat mode
      logger: silentLogger,
    });

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

    // Ensure agent is initialized
    await this.ensureInitialized();
    await this.ensureInitialized();

    if (options?.stream && options.onDelta) {
      return this.runStreaming(request, options);
    }

    return this.runNonStreaming(request);
  }

  /**
   * Non-streaming execution: use PencilAgent.run() which blocks until completion.
   */
  private async runNonStreaming(request: EngineRunRequest): Promise<EngineRunResult> {
    // Build the message from the request
    const message = this.buildUserMessage(request);

    try {
      const text = await this.agent.run(message);

      if (!text || text.trim() === '') {
        throw new EngineError('Engine returned empty response');
      }

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
        err
      );
    }
  }

  /**
   * Streaming execution: use PencilAgent.prompt() + subscribe() for event-driven deltas.
   */
  private async runStreaming(request: EngineRunRequest, options: EngineRunOptions): Promise<EngineRunResult> {
    const message = this.buildUserMessage(request);
    let collectedText = '';
    let finishReason: EngineRunResult['finishReason'] = 'stop';

    // Set up event listener before prompting
    const listener = (event: AgentSessionEvent) => {
      // Collect assistant text from message_end events
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const content = event.message.content;
        if (typeof content === 'string') {
          // message_end might contain the full accumulated text
          // Only use it if we haven't collected anything (fallback)
          if (collectedText === '') {
            collectedText = content;
          }
        }
      }

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
        finishReason = 'stop';
        options.onDelta!({ type: 'done', finishReason: 'stop' });
      }

      // Handle errors
      if (event.type === 'sdk:error') {
        const errorMsg = event.error instanceof Error ? event.error.message : String(event.error);
        options.onDelta!({ type: 'error', error: errorMsg });
      }
    };

    this.agent.subscribe(listener);

    try {
      await this.agent.prompt(message);

      // Fallback: if no deltas were emitted, use the collected text from message_end
      if (collectedText === '' && this.agent.getLastText()) {
        collectedText = this.agent.getLastText();
        // Emit as a single delta for consumers
        options.onDelta!({ type: 'delta', content: collectedText });
        options.onDelta!({ type: 'done', finishReason: 'stop' });
      }
    } catch (err) {
      if (options.signal?.aborted) {
        finishReason = 'cancelled';
        options.onDelta!({ type: 'done', finishReason: 'cancelled' });
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('Streaming error', { agentId: request.agentId, error: errorMsg });
        options.onDelta!({ type: 'error', error: errorMsg });
        finishReason = 'error';
      }
    } finally {
      this.agent.unsubscribe(listener);
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
   * Ensure the PencilAgent session is initialized.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.agent.isInitialized()) {
      await this.agent.init();
      logger.debug('PencilAgent session initialized', {
        provider: this.provider,
        model: this.modelName,
      });
    }
  }

  /**
   * Build a user message string from the request messages.
   * In v0.1, we take the last user message as the prompt.
   * Future versions may use the full conversation history.
   */
  private buildUserMessage(request: EngineRunRequest): string {
    // For v0.1, use the last user message.
    // The session history is managed by the Gateway's SessionStore.
    const userMessages = request.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      throw new EngineError('No user message found in request');
    }
    return userMessages[userMessages.length - 1].content;
  }

  /**
   * Reset the agent session for a new conversation.
   */
  async reset(): Promise<void> {
    if (this.agent.isInitialized()) {
      await this.agent.reset();
    }
  }

  /**
   * Clean up resources.
   */
  async dispose(): Promise<void> {
    if (this.agent.isInitialized()) {
      await this.agent.shutdown();
    }
  }
}

/**
 * Factory function to create a NanoPencilEngineAdapter from AgentConfig.
 */
export function createNanoPencilAdapter(config: AgentConfig): NanoPencilEngineAdapter {
  return new NanoPencilEngineAdapter(config);
}
