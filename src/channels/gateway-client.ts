/**
 * Pencil Channel Gateway HTTP Client
 *
 * [WHO]  Channel wrapper runtime
 * [FROM] ChannelRouter resolution and normalized text messages
 * [TO]  Pencil Agent Gateway OpenAI-compatible HTTP API
 * [HERE] Thin HTTP caller; does not import AgentRegistry, EngineAdapter, or nano-pencil
 */

import { EngineError, InvalidRequestError } from '../util/errors.js';
import { resolveGatewayConfig } from './router.js';
import type { ChannelResolution, NormalizedMessage } from './types.js';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface GatewayErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
}

export async function runChannelMessage(
  message: NormalizedMessage,
  resolution: ChannelResolution,
): Promise<string> {
  const gateway = resolveGatewayConfig(resolution.route);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gateway.timeoutMs ?? 120000);

  try {
    const response = await fetch(`${gateway.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolution.apiKey}`,
        'Content-Type': 'application/json',
        'X-Pencil-Session': resolution.sessionId,
      },
      body: JSON.stringify({
        model: resolution.agentModel,
        messages: [{ role: 'user', content: message.text }],
        stream: false,
        session_id: resolution.sessionId,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as ChatCompletionResponse & GatewayErrorResponse;
    if (!response.ok) {
      throw new EngineError(
        `Gateway chat request failed: ${body.error?.message || response.statusText}`,
      );
    }

    const text = body.choices?.[0]?.message?.content;
    if (!text) {
      throw new InvalidRequestError('Gateway chat response did not contain assistant content');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
