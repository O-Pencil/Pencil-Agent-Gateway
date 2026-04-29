/**
 * Pencil Agent Gateway Engine Adapter Interface
 *
 * [WHO]  Gateway server
 * [FROM] Chat completion routes
 * [TO]  Agent engines (nano-pencil, etc.)
 * [HERE] Abstraction layer for plugging in different agent engines
 */

import type { ChatMessage } from '../protocol/types.js';

/**
 * Engine run request
 */
export interface EngineRunRequest {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Engine delta event (for streaming)
 */
export interface EngineDeltaEvent {
  type: 'delta' | 'done' | 'error';
  content?: string;
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  error?: string;
}

/**
 * Engine run result (non-streaming)
 */
export interface EngineRunResult {
  text: string;
  finishReason: 'stop' | 'length' | 'cancelled' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Engine run options
 */
export interface EngineRunOptions {
  stream?: boolean;
  onDelta?: (event: EngineDeltaEvent) => void;
  signal?: AbortSignal;
}

/**
 * Engine adapter interface
 * All agent engines must implement this interface
 */
export interface EngineAdapter {
  /**
   * Run the engine and generate text
   */
  run(request: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult>;

  /**
   * Optional: re-bind the engine to a new AgentConfig **without** disposing
   * existing in-memory sessions. Used by `PUT /v1/agents/:id` so that updating
   * Soul or model on an agent does not blow away a user's running conversation
   * history. New sessions created after this call see the new config; sessions
   * that already exist keep their prior Soul/model — that is by design (the
   * captured resourceLoader is part of session identity).
   */
  reconfigure?(config: import('../config.js').AgentConfig): void;
}
