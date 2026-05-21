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
 * v0.2 tool callback — caller-side tool advertisement passed through to engine.
 * Wire format: `pencil_client_tools` in chat request body. See docs/18 §5.
 */
export interface ClientToolAdvertisement {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * v0.2 tool callback — caller's response to a tool_request, posted via
 * POST /v1/agents/:id/sessions/:sid/tool_response and forwarded to the
 * adapter through EngineAdapter.provideToolResponse(). See docs/18 §7/§9.
 */
export type ToolCallResponse =
  | { status: 'ok'; output: string }
  | { status: 'error'; error: { code: string; message: string } }
  | { status: 'cancelled' };

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
  /**
   * v0.2 caller-side tool advertisement. When absent the engine MUST NOT emit
   * `tool_request` events; when present the engine MAY emit them and the
   * gateway will route them to the caller. See docs/18 §5.
   */
  clientTools?: ClientToolAdvertisement[];
}

/**
 * Engine delta event (for streaming)
 *
 * v0.2 adds `tool_request` to the callback event vocabulary. v0.1 callers
 * that don't advertise `clientTools` will never see this variant.
 */
export interface EngineDeltaEvent {
  type: 'delta' | 'done' | 'error' | 'tool_request';
  content?: string;
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error' | 'tool_calls';
  error?: string;

  // tool_request fields (only set when type === 'tool_request')
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolTimeoutMs?: number;
}

/**
 * Engine run result (non-streaming)
 */
export interface EngineRunResult {
  text: string;
  finishReason: 'stop' | 'length' | 'cancelled' | 'error' | 'tool_calls';
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

  /**
   * v0.2: deliver a caller-side tool response back into the running engine
   * loop. The adapter is responsible for matching `toolCallId` to its
   * internal pending tool state and unblocking the run.
   *
   * MUST be idempotent — Gateway guarantees single delivery, but adapters
   * must tolerate a second call returning silently. Adapters that do not
   * implement this method are treated as not tool-capable: any inbound
   * tool_response POST returns 404 and any emitted `tool_request` becomes
   * `engine_misconfigured`.
   */
  provideToolResponse?(toolCallId: string, response: ToolCallResponse): Promise<void>;
}
