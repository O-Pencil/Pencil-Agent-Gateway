/**
 * Pencil Agent Gateway Chat Routes
 *
 * [WHO]  Gateway server
 * [FROM] OpenAI SDK clients
 * [TO]  AgentInstance engine (NanoPencilEngineAdapter via registry)
 * [HERE] OpenAI-compatible /v1/chat/completions endpoint
 */

import type { Context } from 'hono';
import { logger } from '../util/logger.js';
import { NotFoundError, UnsupportedFeatureError } from '../util/errors.js';
import { getRegistry } from '../agent/registry.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatDelta,
  ErrorCode,
} from '../protocol/types.js';
import {
  generateChatId,
  validateChatRequest,
  effectiveToolTimeoutMs,
  TOOL_PAYLOAD_MAX_BYTES,
} from '../protocol/types.js';
import { getSessionStore } from '../store/session.js';
import type { ClientToolAdvertisement, EngineAdapter } from '../engine/adapter.js';
import {
  getToolCorrelation,
  ToolTimeoutError,
  SessionLostError,
} from '../engine/tool-correlation.js';

/**
 * Handle chat completion request
 */
export async function handleChatCompletion(c: Context): Promise<Response> {
  const request = await c.req.json<ChatCompletionRequest>();

  // Validate request
  const errors = validateChatRequest(request);
  if (errors.length > 0) {
    throw new UnsupportedFeatureError(errors.join('; '));
  }

  // Get agent from registry
  const registry = getRegistry();
  const instance = registry.getByModelId(request.model);

  if (!instance) {
    throw new NotFoundError(`Agent instance '${request.model}' not found`);
  }

  // Extract session ID from request or header
  const sessionId = request.session_id || c.req.header('x-pencil-session') || crypto.randomUUID();

  // Get session store
  const sessionStore = getSessionStore();
  const maxTurns = instance.config.memory?.maxTurns || 20;

  // Append the new user messages from the request to the gateway-side audit log.
  // Conversation history that the engine actually sees is owned by the engine
  // (per-session PencilAgent inMemory state) — the gateway does not replay prior
  // turns into the engine, which avoids the previous double-feed bug.
  for (const msg of request.messages) {
    if (msg.role === 'user') {
      sessionStore.addMessage(instance.id, sessionId, msg, { maxTurns });
    }
  }

  const session = sessionStore.getOrCreate(instance.id, sessionId, { maxTurns });

  // Forward the request messages as-is to the engine adapter.
  const messages = request.messages;

  // Generate chat ID
  const chatId = generateChatId();
  const created = Math.floor(Date.now() / 1000);

  logger.info('Chat completion request', {
    requestId: c.get('requestId'),
    chatId,
    model: request.model,
    sessionId,
    stream: request.stream ?? false,
    historyLength: session.messages.length,
  });

  // Map wire `pencil_client_tools` (snake_case, timeout_ms) to engine-side
  // ClientToolAdvertisement (camelCase, timeoutMs). Stays optional — when
  // absent the engine MUST NOT emit tool_request per docs/18 §5.
  const clientTools: ClientToolAdvertisement[] | undefined =
    request.pencil_client_tools && request.pencil_client_tools.length > 0
      ? request.pencil_client_tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          timeoutMs: t.timeout_ms,
        }))
      : undefined;

  // Handle streaming
  if (request.stream) {
    return handleStreaming(
      c,
      request,
      instance,
      sessionId,
      chatId,
      created,
      messages,
      clientTools,
    );
  }

  // Handle non-streaming
  return handleNonStreaming(
    c,
    request,
    instance,
    sessionId,
    chatId,
    created,
    messages,
    clientTools,
  );
}

/**
 * Handle non-streaming chat completion
 */
async function handleNonStreaming(
  c: Context,
  request: ChatCompletionRequest,
  instance: { id: string; engine: EngineAdapter; config: { memory?: { maxTurns: number } } },
  sessionId: string,
  chatId: string,
  created: number,
  messages: typeof request.messages,
  clientTools: ClientToolAdvertisement[] | undefined,
): Promise<Response> {
  if (clientTools) {
    // v0.2 non-streaming + tool callback is intentionally unsupported: tool
    // round-trips require the SSE outbound channel. Caller should set
    // `stream: true` when advertising client tools.
    throw new UnsupportedFeatureError(
      'pencil_client_tools requires stream:true (tool callback uses SSE outbound channel)',
    );
  }

  const result = await instance.engine.run({
    agentId: instance.id,
    sessionId,
    messages,
    options: {
      temperature: request.temperature,
      maxTokens: request.max_tokens,
    },
  });

  // Save assistant response to session
  const sessionStore = getSessionStore();
  const maxTurns = instance.config.memory?.maxTurns || 20;
  sessionStore.addMessage(
    instance.id,
    sessionId,
    {
      role: 'assistant',
      content: result.text,
    },
    { maxTurns }
  );

  // Map engine finish reason to OpenAI finish reason
  const finishReason: 'stop' | 'length' | 'cancelled' | 'content_filter' | 'tool_calls' =
    result.finishReason === 'error' || result.finishReason === undefined
      ? 'stop'
      : (result.finishReason as 'stop' | 'length' | 'cancelled');

  const response: ChatCompletionResponse = {
    id: chatId,
    object: 'chat.completion',
    created,
    model: request.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.text,
        },
        finish_reason: finishReason,
      },
    ],
    usage: result.usage
      ? {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        }
      : {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
  };

  logger.info('Chat completion response', {
    requestId: c.get('requestId'),
    chatId,
    finishReason: result.finishReason,
  });

  return c.json(response);
}

/**
 * Handle streaming chat completion
 */
async function handleStreaming(
  c: Context,
  request: ChatCompletionRequest,
  instance: { id: string; engine: EngineAdapter; config: { memory?: { maxTurns: number } } },
  sessionId: string,
  chatId: string,
  created: number,
  messages: typeof request.messages,
  clientTools: ClientToolAdvertisement[] | undefined,
): Promise<Response> {
  const sessionStore = getSessionStore();
  const maxTurns = instance.config.memory?.maxTurns || 20;
  let assistantResponse = '';

  const advertised = new Map<string, ClientToolAdvertisement>();
  for (const t of clientTools ?? []) {
    advertised.set(t.name, t);
  }

  const apiKey = c.get('apiKey')?.key ?? '';
  const toolCorr = getToolCorrelation();
  /** Tool call ids registered during this turn — for SSE-abort cleanup. */
  const ownedToolCallIds: string[] = [];

  // Create a readable stream for SSE.
  // Node's strict body reader (undici) requires Uint8Array chunks; production
  // network responses survive because the HTTP layer encodes, but app.fetch()
  // in tests reads the body directly and surfaces non-bytes as TypeErrors.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false;
      const safeEnqueue = (payload: string) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          streamClosed = true;
        }
      };

      try {
        // Send initial chunk with role
        const initialChunk = createDeltaChunk(chatId, created, request.model, { role: 'assistant' }, null);
        safeEnqueue(serializeChunk(initialChunk));

        // Run engine with streaming
        await instance.engine.run(
          {
            agentId: instance.id,
            sessionId,
            messages,
            options: {
              temperature: request.temperature,
              maxTokens: request.max_tokens,
            },
            clientTools,
          },
          {
            stream: true,
            onDelta: (event) => {
              if (event.type === 'delta' && event.content) {
                assistantResponse += event.content;
                const deltaChunk = createDeltaChunk(
                  chatId,
                  created,
                  request.model,
                  { content: event.content },
                  null
                );
                safeEnqueue(serializeChunk(deltaChunk));
              } else if (event.type === 'tool_request') {
                handleEngineToolRequest({
                  event,
                  instance,
                  sessionId,
                  apiKey,
                  advertised,
                  toolCorr,
                  ownedToolCallIds,
                  safeEnqueue,
                  logCtx: {
                    requestId: c.get('requestId'),
                    chatId,
                  },
                });
              } else if (event.type === 'done') {
                // Save assistant response to session
                sessionStore.addMessage(
                  instance.id,
                  sessionId,
                  {
                    role: 'assistant',
                    content: assistantResponse,
                  },
                  { maxTurns }
                );

                // Map finish reason to OpenAI finish reason
                const finishReason: 'stop' | 'length' | 'cancelled' | 'content_filter' | 'tool_calls' =
                  event.finishReason === 'error' || event.finishReason === undefined
                    ? 'stop'
                    : event.finishReason;

                const finalChunk = createDeltaChunk(chatId, created, request.model, {}, finishReason);
                safeEnqueue(serializeChunk(finalChunk));
                safeEnqueue(SSE_DONE);
              } else if (event.type === 'error') {
                // Pass upstream error through verbatim. Use OpenAI's top-level
                // error envelope (`data: {"error":{...}}`) — most compatible
                // clients (openai-node, openai-python, vercel/ai) parse it,
                // and those that don't still see the full message in the SSE
                // log. Deliberately do NOT send a `finish_reason: 'stop'`
                // delta first — that would lie about a normal completion and
                // hide the failure (which is what was happening before).
                const errMsg = event.error || 'Unknown engine error';
                logger.error('Engine error during streaming', {
                  requestId: c.get('requestId'),
                  chatId,
                  error: errMsg,
                });
                safeEnqueue(serializeError(errMsg));
                safeEnqueue(SSE_DONE);
              }
            },
            signal: c.req.raw.signal,
          },
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('Streaming run threw uncaught', {
          requestId: c.get('requestId'),
          chatId,
          error: errMsg,
        });
        safeEnqueue(serializeError(errMsg));
        safeEnqueue(SSE_DONE);
      } finally {
        // Cancel any tool calls still pending — the client is gone or run ended.
        for (const id of ownedToolCallIds) {
          toolCorr.cancel(id);
        }
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Serialize the v0.2 `event: pencil.tool_request` SSE frame.
 */
export function serializeToolRequestEvent(payload: {
  toolCallId: string;
  sessionId: string;
  agentId: string;
  name: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
  issuedAt: string;
}): string {
  const body = {
    tool_call_id: payload.toolCallId,
    session_id: payload.sessionId,
    agent_id: payload.agentId,
    name: payload.name,
    arguments: payload.arguments,
    timeout_ms: payload.timeoutMs,
    issued_at: payload.issuedAt,
  };
  return `event: pencil.tool_request\ndata: ${JSON.stringify(body)}\n\n`;
}

/**
 * Build the OpenAI-shaped error envelope SSE frame for one of the v0.2
 * tool-callback error codes. Mirrors `serializeError` but lets us emit a
 * specific code/type pair instead of the generic `engine_error`.
 */
export function serializeToolError(code: ErrorCode, message: string): string {
  const payload = {
    error: {
      type: code,
      code,
      message,
    },
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface ToolRequestHandlerCtx {
  event: { type: string; toolCallId?: string; toolName?: string; toolArguments?: Record<string, unknown>; toolTimeoutMs?: number };
  instance: { id: string; engine: EngineAdapter };
  sessionId: string;
  apiKey: string;
  advertised: Map<string, ClientToolAdvertisement>;
  toolCorr: ReturnType<typeof getToolCorrelation>;
  ownedToolCallIds: string[];
  safeEnqueue: (payload: string) => void;
  logCtx: { requestId: unknown; chatId: string };
}

function handleEngineToolRequest(ctx: ToolRequestHandlerCtx): void {
  const {
    event,
    instance,
    sessionId,
    apiKey,
    advertised,
    toolCorr,
    ownedToolCallIds,
    safeEnqueue,
    logCtx,
  } = ctx;

  const toolCallId = event.toolCallId;
  const name = event.toolName;
  const args = event.toolArguments ?? {};
  if (!toolCallId || !name) {
    safeEnqueue(serializeToolError('tool_invalid_response', 'engine emitted malformed tool_request'));
    safeEnqueue(SSE_DONE);
    return;
  }

  // 1. Adapter must support tool callback.
  if (!instance.engine.provideToolResponse) {
    safeEnqueue(
      serializeToolError(
        'engine_misconfigured',
        `engine adapter does not implement provideToolResponse; cannot route tool '${name}'`,
      ),
    );
    safeEnqueue(SSE_DONE);
    return;
  }

  // 2. Advertised?
  if (!advertised.has(name)) {
    safeEnqueue(
      serializeToolError(
        'tool_not_advertised',
        `engine requested tool '${name}' which was not advertised in pencil_client_tools`,
      ),
    );
    safeEnqueue(SSE_DONE);
    // Also unblock the adapter so it doesn't hang.
    void instance.engine.provideToolResponse(toolCallId, {
      status: 'error',
      error: { code: 'tool_not_advertised', message: 'caller did not advertise this tool' },
    });
    return;
  }

  // 3. Arguments size cap (§16 decision 4).
  const argsJson = JSON.stringify(args);
  if (Buffer.byteLength(argsJson, 'utf8') > TOOL_PAYLOAD_MAX_BYTES) {
    safeEnqueue(
      serializeToolError(
        'tool_payload_too_large',
        `tool '${name}' arguments exceed ${TOOL_PAYLOAD_MAX_BYTES} bytes`,
      ),
    );
    safeEnqueue(SSE_DONE);
    void instance.engine.provideToolResponse(toolCallId, {
      status: 'error',
      error: { code: 'tool_payload_too_large', message: 'arguments too large' },
    });
    return;
  }

  // 4. Effective timeout (per-tool advertised → default; capped 120 s).
  const advertisedEntry = advertised.get(name)!;
  const requestedTimeout = event.toolTimeoutMs ?? advertisedEntry.timeoutMs;
  const timeoutMs = effectiveToolTimeoutMs(requestedTimeout);

  // 5. Register with correlation table. Throws on serialized-violation.
  let waiter: Promise<import('../engine/adapter.js').ToolCallResponse>;
  try {
    waiter = toolCorr.register({
      toolCallId,
      sessionId,
      agentId: instance.id,
      apiKey,
      name,
      timeoutMs,
    });
  } catch (err) {
    safeEnqueue(
      serializeToolError(
        'engine_misconfigured',
        err instanceof Error ? err.message : String(err),
      ),
    );
    safeEnqueue(SSE_DONE);
    void instance.engine.provideToolResponse(toolCallId, {
      status: 'error',
      error: { code: 'engine_misconfigured', message: 'serialized violation' },
    });
    return;
  }

  ownedToolCallIds.push(toolCallId);

  // 6. Emit the SSE event to the caller.
  safeEnqueue(
    serializeToolRequestEvent({
      toolCallId,
      sessionId,
      agentId: instance.id,
      name,
      arguments: args,
      timeoutMs,
      issuedAt: new Date().toISOString(),
    }),
  );

  // 7. Bridge: when caller POSTs response (or timeout fires), forward to adapter.
  waiter.then(
    (response) => {
      void instance.engine.provideToolResponse!(toolCallId, response);
    },
    (err) => {
      // Surface specific error code on SSE before unblocking adapter.
      let code: ErrorCode = 'tool_invalid_response';
      let message = err instanceof Error ? err.message : String(err);
      if (err instanceof ToolTimeoutError) {
        code = 'tool_timeout';
        message = `tool '${name}' did not respond within ${timeoutMs}ms`;
      } else if (err instanceof SessionLostError) {
        code = 'session_lost';
      }
      safeEnqueue(serializeToolError(code, message));
      safeEnqueue(SSE_DONE);
      void instance.engine.provideToolResponse!(toolCallId, {
        status: 'error',
        error: { code, message },
      });
      logger.warn('tool_request failed', {
        requestId: logCtx.requestId,
        chatId: logCtx.chatId,
        toolCallId,
        name,
        code,
      });
    },
  );
}

/**
 * SSE chunk serializer
 */
export function serializeChunk(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * SSE error envelope serializer.
 *
 * Format matches OpenAI's mid-stream error convention: a top-level
 * `{ error: { type, code, message } }` object delivered as one `data:` frame,
 * followed by `data: [DONE]\n\n`. Most OpenAI-compatible clients parse this;
 * those that don't will still see the full message in the SSE log instead of
 * a misleading `finish_reason: 'stop'`.
 */
export function serializeError(message: string): string {
  const payload = {
    error: {
      type: 'engine_error',
      code: 'engine_error',
      message,
    },
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * SSE done sentinel
 */
export const SSE_DONE = 'data: [DONE]\n\n';

/**
 * Create SSE delta chunk
 */
export function createDeltaChunk(
  chatId: string,
  created: number,
  model: string,
  delta: ChatDelta,
  finishReason: 'stop' | 'length' | 'cancelled' | 'content_filter' | 'tool_calls' | null
): ChatCompletionChunk {
  return {
    id: chatId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}
