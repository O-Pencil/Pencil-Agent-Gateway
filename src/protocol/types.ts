/**
 * Pencil Agent Gateway OpenAI-Compatible Protocol Types
 *
 * [WHO]  Gateway server
 * [FROM] OpenAI SDK clients
 * [TO]  Engine adapters, response handlers
 * [HERE] OpenAI-compatible request/response type definitions
 */

/**
 * Chat message role
 */
export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Chat message
 */
export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/**
 * Tool definition (ignored in v0.1)
 */
export interface Tool {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * v0.2 caller-side tool advertisement.
 *
 * Wire field name: `pencil_client_tools`. See docs/18 §5.
 *
 * Intentionally separate from OpenAI's `tools` field so the two surfaces
 * don't collide; v0.2 accepts `tools`/`tool_choice` but still ignores them.
 */
export interface PencilClientToolAdvertisement {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  timeout_ms?: number;
}

/**
 * Tool name must be ASCII identifier-ish.
 * See docs/18 §5.
 */
export const TOOL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/**
 * Per-tool timeout hard cap. See docs/18 §5.
 */
export const TOOL_TIMEOUT_MAX_MS = 120_000;

/**
 * Default per-tool timeout when caller omits `timeout_ms`. See docs/18 §5.
 */
export const TOOL_TIMEOUT_DEFAULT_MS = 30_000;

/**
 * Per-side payload cap. Applies to both inbound `output` and outbound
 * `arguments` (§16 decision 4). See docs/18 §13.
 */
export const TOOL_PAYLOAD_MAX_BYTES = 256 * 1024;

/**
 * Chat completion request
 */
export interface ChatCompletionRequest {
  // Required fields
  model: string;
  messages: ChatMessage[];

  // Optional fields
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  n?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;

  // Ignored fields in v0.1 (still ignored in v0.2; superseded by pencil_client_tools)
  tools?: Tool[];
  tool_choice?: unknown;

  // Response format (text only in v0.1)
  response_format?: { type: string };

  // Extension field for Pencil Gateway
  session_id?: string;

  /**
   * v0.2 caller-side tool advertisement. When absent the engine MUST NOT
   * emit tool_request events. See docs/18 §5.
   */
  pencil_client_tools?: PencilClientToolAdvertisement[];
}

/**
 * Chat choice message
 */
export interface ChatMessageResponse {
  role: 'assistant';
  content: string;
  tool_calls?: unknown[];
}

/**
 * Chat choice
 */
export interface ChatChoice {
  index: number;
  message: ChatMessageResponse;
  finish_reason: 'stop' | 'length' | 'cancelled' | 'content_filter' | 'tool_calls';
}

/**
 * Usage information
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: Usage;
}

/**
 * Chat delta
 */
export interface ChatDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: unknown[];
}

/**
 * Chat chunk choice
 */
export interface ChatChunkChoice {
  index: number;
  delta: ChatDelta;
  finish_reason: 'stop' | 'length' | 'cancelled' | 'content_filter' | 'tool_calls' | null;
}

/**
 * Chat completion chunk (SSE)
 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatChunkChoice[];
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/**
 * Model list response
 */
export interface ModelListResponse {
  object: 'list';
  data: ModelInfo[];
}

/**
 * Error types
 */
export type ErrorType =
  | 'invalid_request_error'
  | 'unauthorized'
  | 'forbidden_agent'
  | 'agent_not_found'
  | 'engine_error'
  | 'unsupported_feature'
  | 'client_cancelled'
  | 'agent_conflict'
  // v0.2 tool callback errors — see docs/18 §13.
  | 'tool_not_advertised'
  | 'tool_timeout'
  | 'tool_payload_too_large'
  | 'tool_invalid_response'
  | 'engine_misconfigured'
  | 'session_lost';

/**
 * Error code
 */
export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden_agent'
  | 'agent_not_found'
  | 'engine_error'
  | 'unsupported_feature'
  | 'client_cancelled'
  | 'agent_conflict'
  // v0.2 tool callback codes — see docs/18 §13.
  | 'tool_not_advertised'
  | 'tool_timeout'
  | 'tool_payload_too_large'
  | 'tool_invalid_response'
  | 'engine_misconfigured'
  | 'session_lost';

/**
 * OpenAI error response
 */
export interface OpenAIErrorResponse {
  error: {
    type: ErrorType;
    code: ErrorCode;
    message: string;
  };
}

/**
 * Generate chat completion ID
 */
export function generateChatId(): string {
  return `chatcmpl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Validate chat completion request
 */
export function validateChatRequest(request: ChatCompletionRequest): string[] {
  const errors: string[] = [];

  if (!request.model) {
    errors.push('model is required');
  }

  if (!request.messages || request.messages.length === 0) {
    errors.push('messages must not be empty');
  }

  if (request.n !== undefined && request.n !== 1) {
    errors.push('n must be 1 (only single response is supported in v0.1)');
  }

  if (
    request.response_format &&
    request.response_format.type !== undefined &&
    request.response_format.type !== 'text'
  ) {
    errors.push('response_format.type must be "text" (JSON mode not supported in v0.1)');
  }

  // v0.2 pencil_client_tools — validate per-tool shape if present.
  if (request.pencil_client_tools !== undefined) {
    if (!Array.isArray(request.pencil_client_tools)) {
      errors.push('pencil_client_tools must be an array');
    } else {
      const seen = new Set<string>();
      for (const t of request.pencil_client_tools) {
        if (!t || typeof t !== 'object') {
          errors.push('pencil_client_tools entry must be an object');
          continue;
        }
        if (!t.name || !TOOL_NAME_REGEX.test(t.name)) {
          errors.push(`pencil_client_tools[].name must match ${TOOL_NAME_REGEX} (got: ${t.name})`);
        } else if (seen.has(t.name)) {
          errors.push(`pencil_client_tools contains duplicate name: ${t.name}`);
        } else {
          seen.add(t.name);
        }
        if (t.timeout_ms !== undefined) {
          if (
            typeof t.timeout_ms !== 'number' ||
            !Number.isFinite(t.timeout_ms) ||
            t.timeout_ms <= 0
          ) {
            errors.push(`pencil_client_tools[${t.name}].timeout_ms must be positive number`);
          } else if (t.timeout_ms > TOOL_TIMEOUT_MAX_MS) {
            errors.push(
              `pencil_client_tools[${t.name}].timeout_ms exceeds ${TOOL_TIMEOUT_MAX_MS} cap`,
            );
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Pick the effective timeout for a tool invocation.
 * Order: caller-advertised value → default; capped at TOOL_TIMEOUT_MAX_MS.
 * See docs/18 §5.
 */
export function effectiveToolTimeoutMs(advertised?: number): number {
  const requested = advertised ?? TOOL_TIMEOUT_DEFAULT_MS;
  return Math.min(requested, TOOL_TIMEOUT_MAX_MS);
}
