/**
 * Pencil Agent Gateway Tool Response Route
 *
 * [WHO]  Gateway server
 * [FROM] Callers (editor / CLI / 3rd-party) responding to a pencil.tool_request
 *        emitted on the SSE stream of an open chat completion turn.
 * [TO]   ToolCorrelation -> EngineAdapter.provideToolResponse (unblocks the
 *        running engine loop).
 * [HERE] POST /v1/agents/:agentId/sessions/:sessionId/tool_response
 *        Inbound half of the v0.2 tool callback dual channel. See docs/18 §7.
 */

import type { Context } from 'hono';
import { logger } from '../util/logger.js';
import {
  GatewayError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidRequestError,
} from '../util/errors.js';

/**
 * 422 Unprocessable Entity for body shape problems. We use this specifically
 * instead of `InvalidRequestError` (400) because docs/18 §7 reserves 422 for
 * "request shape invalid" on the tool_response endpoint — 400 is for other
 * route-generic invalid requests.
 */
class UnprocessableBodyError extends GatewayError {
  constructor(message: string) {
    super(message, 422, 'invalid_request');
    this.name = 'UnprocessableBodyError';
  }
}
import { getToolCorrelation } from '../engine/tool-correlation.js';
import { getRegistry } from '../agent/registry.js';
import { validateSafeId } from '../store/session.js';
import { TOOL_PAYLOAD_MAX_BYTES } from '../protocol/types.js';
import type { ToolCallResponse } from '../engine/adapter.js';

/**
 * Inbound JSON body shape. We re-validate here rather than reuse a shared type
 * because the wire form uses snake_case while the adapter type uses status
 * union — wire-level validation belongs at the boundary.
 */
interface ToolResponseBody {
  tool_call_id?: unknown;
  status?: unknown;
  output?: unknown;
  error?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 410 Gone. Used when a session/tool entered an invalidated state.
 */
class GoneError extends GatewayError {
  constructor(message: string) {
    super(message, 410, 'session_lost');
    this.name = 'GoneError';
  }
}

/**
 * 413 Payload Too Large.
 */
class PayloadTooLargeError extends GatewayError {
  constructor(message: string) {
    super(message, 413, 'tool_payload_too_large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Parse + validate the inbound body. Throws GatewayError(422) on shape
 * problems, GatewayError(413) on oversized output. Returns the
 * domain-shaped `ToolCallResponse` plus the `tool_call_id`.
 */
function parseBody(raw: unknown): { toolCallId: string; response: ToolCallResponse } {
  if (!isObject(raw)) {
    throw new UnprocessableBodyError('request body must be a JSON object');
  }
  const body = raw as ToolResponseBody;

  if (typeof body.tool_call_id !== 'string' || body.tool_call_id.length === 0) {
    throw new UnprocessableBodyError('tool_call_id (string) is required');
  }
  const toolCallId = body.tool_call_id;

  if (body.status !== 'ok' && body.status !== 'error' && body.status !== 'cancelled') {
    throw new UnprocessableBodyError('status must be one of: "ok" | "error" | "cancelled"');
  }

  if (body.status === 'ok') {
    if (typeof body.output !== 'string') {
      throw new UnprocessableBodyError('status="ok" requires output (string)');
    }
    const bytes = Buffer.byteLength(body.output, 'utf8');
    if (bytes > TOOL_PAYLOAD_MAX_BYTES) {
      throw new PayloadTooLargeError(
        `output is ${bytes} bytes; cap is ${TOOL_PAYLOAD_MAX_BYTES}`,
      );
    }
    return {
      toolCallId,
      response: { status: 'ok', output: body.output },
    };
  }

  if (body.status === 'error') {
    if (!isObject(body.error)) {
      throw new UnprocessableBodyError('status="error" requires error: { code, message }');
    }
    const code = body.error.code;
    const message = body.error.message;
    if (typeof code !== 'string' || code.length === 0) {
      throw new UnprocessableBodyError('error.code (string) is required when status="error"');
    }
    if (typeof message !== 'string') {
      throw new UnprocessableBodyError('error.message (string) is required when status="error"');
    }
    return {
      toolCallId,
      response: { status: 'error', error: { code, message } },
    };
  }

  // status === 'cancelled'
  return {
    toolCallId,
    response: { status: 'cancelled' },
  };
}

/**
 * Handle POST /v1/agents/:agentId/sessions/:sessionId/tool_response.
 *
 * Status codes per docs/18 §7:
 *   202 — accepted, engine resumed
 *   401 — handled by auth middleware before reaching here
 *   403 — apiKey not the one that opened this tool call
 *   404 — tool_call_id unknown OR doesn't belong to this (agentId, sessionId)
 *   409 — id already received a response
 *   410 — session was invalidated before response arrived
 *   413 — output exceeded cap
 *   422 — request shape invalid
 */
export async function handleToolResponse(c: Context): Promise<Response> {
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');

  // validateSafeId throws InvalidRequestError(400) on bad shape; we re-throw
  // as 422 to match the protocol convention (request shape problem) rather
  // than the 400 default for generic invalid_request.
  try {
    validateSafeId(agentId, 'agentId');
    validateSafeId(sessionId, 'sessionId');
  } catch (err) {
    if (err instanceof InvalidRequestError) {
      throw new GatewayError(err.message, 422, 'invalid_request');
    }
    throw err;
  }

  const raw = await c.req.json().catch(() => null);
  const { toolCallId, response } = parseBody(raw);

  const apiKey = c.get('apiKey')?.key ?? '';
  const corr = getToolCorrelation();
  const entry = corr.lookupFull(toolCallId);

  if (!entry) {
    throw new NotFoundError(`tool_call '${toolCallId}' not found`);
  }

  // Ownership: same API Key, same (agentId, sessionId).
  if (entry.apiKey !== apiKey) {
    throw new ForbiddenError(`tool_call '${toolCallId}' does not belong to this API Key`);
  }
  if (entry.agentId !== agentId || entry.sessionId !== sessionId) {
    // Don't leak existence; reuse 404.
    throw new NotFoundError(`tool_call '${toolCallId}' not found in this session`);
  }

  // Hand the response to the correlation table; it routes to the engine.
  const outcome = corr.deliver(toolCallId, response);
  switch (outcome) {
    case 'ok':
      logger.info('tool_response accepted', {
        requestId: c.get('requestId'),
        toolCallId,
        agentId,
        sessionId,
        status: response.status,
      });
      // Forward to the EngineAdapter on this agent so it can unblock its run().
      // NOTE: correlation.deliver() resolved the awaiting promise; chat.ts
      // bridges that promise into adapter.provideToolResponse. We still need
      // to handle the case where the adapter has gone missing (rare — agent
      // was deleted mid-tool). We attempt a defensive direct invoke for
      // robustness but treat its absence as silent — chat.ts is the
      // authoritative path.
      try {
        const registry = getRegistry();
        const instance = registry.get(agentId);
        if (!instance?.engine.provideToolResponse) {
          logger.warn('tool_response: adapter missing provideToolResponse', {
            agentId,
            toolCallId,
          });
        }
      } catch {
        // Registry lookup is best-effort here.
      }
      return c.json({ accepted: true, tool_call_id: toolCallId }, 202);

    case 'not_found':
      // Race: correlation entry vanished between lookup and deliver.
      throw new NotFoundError(`tool_call '${toolCallId}' not found`);

    case 'already':
      throw new ConflictError(`tool_call '${toolCallId}' already resolved`);

    case 'invalidated':
      throw new GoneError(`tool_call '${toolCallId}' session was invalidated`);
  }
}
