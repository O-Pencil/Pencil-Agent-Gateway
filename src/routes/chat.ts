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
} from '../protocol/types.js';
import { generateChatId, validateChatRequest } from '../protocol/types.js';
import { getSessionStore } from '../store/session.js';

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

  // Handle streaming
  if (request.stream) {
    return handleStreaming(
      c,
      request,
      instance,
      sessionId,
      chatId,
      created,
      messages
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
    messages
  );
}

/**
 * Handle non-streaming chat completion
 */
async function handleNonStreaming(
  c: Context,
  request: ChatCompletionRequest,
  instance: { id: string; engine: { run: (req: { agentId: string; sessionId: string; messages: typeof request.messages; options?: { temperature?: number; maxTokens?: number } }) => Promise<{ text: string; finishReason: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> }; config: { memory?: { maxTurns: number } } },
  sessionId: string,
  chatId: string,
  created: number,
  messages: typeof request.messages
): Promise<Response> {
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
  instance: { id: string; engine: { run: (req: { agentId: string; sessionId: string; messages: typeof request.messages; options?: { temperature?: number; maxTokens?: number } }, opts?: { stream?: boolean; onDelta?: (event: any) => void; signal?: AbortSignal }) => Promise<{ text: string; finishReason: string }>; }; config: { memory?: { maxTurns: number } } },
  sessionId: string,
  chatId: string,
  created: number,
  messages: typeof request.messages
): Promise<Response> {
  const sessionStore = getSessionStore();
  const maxTurns = instance.config.memory?.maxTurns || 20;
  let assistantResponse = '';

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial chunk with role
        const initialChunk = createDeltaChunk(chatId, created, request.model, { role: 'assistant' }, null);
        controller.enqueue(serializeChunk(initialChunk));

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
                controller.enqueue(serializeChunk(deltaChunk));
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
                controller.enqueue(serializeChunk(finalChunk));
                controller.enqueue(SSE_DONE);
              } else if (event.type === 'error') {
                // Send error in stream
                const errorChunk = createDeltaChunk(chatId, created, request.model, {}, 'stop');
                controller.enqueue(serializeChunk(errorChunk));
                controller.enqueue(SSE_DONE);
              }
            },
            signal: c.req.raw.signal,
          },
        );
      } catch (err) {
        logger.error('Streaming error', {
          requestId: c.get('requestId'),
          chatId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Send error chunk
        const errorChunk = createDeltaChunk(chatId, created, request.model, {}, 'stop');
        controller.enqueue(serializeChunk(errorChunk));
        controller.enqueue(SSE_DONE);
      } finally {
        controller.close();
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
 * SSE chunk serializer
 */
export function serializeChunk(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
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
