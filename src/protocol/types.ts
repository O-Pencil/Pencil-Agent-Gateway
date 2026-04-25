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

  // Ignored fields in v0.1
  tools?: Tool[];
  tool_choice?: unknown;

  // Response format (text only in v0.1)
  response_format?: { type: string };

  // Extension field for Pencil Gateway
  session_id?: string;
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
  | 'agent_conflict';

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
  | 'agent_conflict';

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

  return errors;
}
