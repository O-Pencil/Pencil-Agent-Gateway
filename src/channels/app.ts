/**
 * Pencil Channel HTTP App
 *
 * [WHO]  Channel wrapper server
 * [FROM] WeChat/Feishu webhook HTTP callbacks
 * [TO]  Channel adapters and Gateway HTTP client
 * [HERE] Channel webhook routes; this app is separate from the OpenAI-compatible Gateway app
 */

import { Hono } from 'hono';
import { GatewayError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { DingTalkAdapter, normalizeDingTalkPayload, verifyDingTalkRelayAuth } from './dingtalk/adapter.js';
import { resolveStreamingContext, streamDingTalkReply } from './dingtalk/streaming.js';
import { FeishuAdapter, normalizeFeishuPayload, verifyFeishuPayload } from './feishu/adapter.js';
import { runChannelMessage } from './gateway-client.js';
import { resolveChannelMessage } from './router.js';
import {
  normalizeWeChatText,
  parseWeChatTextXml,
  renderWeChatTextReply,
  verifyWeChatSignature,
} from './wechat/adapter.js';

/**
 * Per-session FIFO queue. Channel messages on the same sessionId are
 * processed sequentially so a slow LLM turn doesn't collide with the next
 * incoming message on the same chat (which would otherwise produce
 * "Agent is already processing" from the engine layer).
 *
 * This is intentionally process-local and unbounded. For a single pencil
 * with a handful of chats, that is fine; for multi-tenant production a
 * bounded queue with backpressure replies belongs at the engine layer.
 *
 * Cleared on Gateway restart — on restart, DingTalk's redelivery (when it
 * applies) will re-enqueue any unACKed events naturally.
 */
const sessionQueues = new Map<string, Promise<void>>();

function enqueueSessionTask(sessionId: string, task: () => Promise<void>): void {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined) // swallow upstream task errors so the chain isn't poisoned
    .then(task)
    .catch((err) => {
      logger.warn('Session task failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      // GC the entry once this task is the tail of the chain — keeps the map
      // bounded by active concurrent sessions, not lifetime traffic.
      if (sessionQueues.get(sessionId) === next) {
        sessionQueues.delete(sessionId);
      }
    });
  sessionQueues.set(sessionId, next);
}

/**
 * Build a user-facing error message for delivery back into the chat platform.
 *
 * Goals:
 *  - Keep the body short — chat UIs truncate aggressively and users don't read
 *    stack traces.
 *  - Show actionable categories (rate limit / busy / config) instead of raw
 *    SDK error strings whenever we can recognise them.
 *  - Never leak the API key, internal file paths, or stack traces.
 *  - Always return a string suitable for DingTalk markdown delivery.
 */
function formatChannelErrorReply(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = err instanceof GatewayError ? err.code : undefined;

  // Map well-known patterns to friendly categories. Order matters — more
  // specific patterns first.
  if (/Agent is already processing/i.test(raw)) {
    return [
      '**Pencil 正在思考上一条消息**',
      '',
      '同一个会话里我一次只处理一条请求，请等当前回复完成后再发。',
    ].join('\n');
  }
  if (/rate.?limit|429|too many requests|RPM|TPM/i.test(raw)) {
    return [
      '**Pencil 触发模型限流**',
      '',
      '上游模型暂时拒绝了请求（可能是 RPM/TPM 配额）。请稍后重试，或在 settings.json 切到其他 provider。',
    ].join('\n');
  }
  if (/No model selected|No API key found|not found for provider/i.test(raw)) {
    return [
      '**Pencil 模型配置异常**',
      '',
      '当前 pencil 找不到可用模型或 API key。请检查 `~/.pencils/<name>/settings.json` 与 `auth.json`。',
      '',
      `> ${raw}`,
    ].join('\n');
  }
  if (code === 'agent_not_found' || code === 'forbidden_agent') {
    return [
      '**Pencil 路由失败**',
      '',
      raw,
    ].join('\n');
  }

  // Fallback — show the raw message but cap the length so a runaway error
  // doesn't blow past DingTalk's markdown limits.
  const trimmed = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  return [
    '**Pencil 处理失败**',
    '',
    `> ${trimmed}`,
  ].join('\n');
}

/**
 * Legacy single-shot delivery path: run chat completion to a complete reply,
 * then POST it to sessionWebhook as a markdown card. Used as a fallback when
 * AI-card streaming is not configured (or when card creation fails).
 *
 * Errors are caught and re-delivered as a friendly error markdown so the
 * user is never left in silence — same contract as the streaming path.
 */
async function runChannelMessageWithFallbackDelivery(
  accountId: string,
  message: import('./types.js').NormalizedMessage,
  resolution: import('./types.js').ChannelResolution,
): Promise<void> {
  const adapter = new DingTalkAdapter(accountId);
  let reply: string;
  try {
    reply = await runChannelMessage(message, resolution);
  } catch (err) {
    const errorText = formatChannelErrorReply(err);
    logger.warn('DingTalk fallback channel processing failed; delivering error card', {
      accountId,
      chatId: message.chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await adapter.deliver({
        channel: 'dingtalk',
        accountId,
        chatType: message.chatType,
        chatId: message.chatId,
        threadId: message.threadId,
        text: errorText,
        replyToMessageId: message.id,
        raw: message.raw,
      });
    } catch (deliverErr) {
      logger.error('DingTalk fallback error-card delivery also failed', {
        accountId,
        error: deliverErr instanceof Error ? deliverErr.message : String(deliverErr),
      });
    }
    return;
  }

  await adapter.deliver({
    channel: 'dingtalk',
    accountId,
    chatType: message.chatType,
    chatId: message.chatId,
    threadId: message.threadId,
    text: reply,
    replyToMessageId: message.id,
    raw: message.raw,
  });
}

export function createChannelApp(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    return c.json({ status: 'ok', service: 'pencil-channel-wrapper', timestamp: new Date().toISOString() });
  });

  app.post('/channels/dingtalk/:accountId/webhook', async (c) => {
    const accountId = c.req.param('accountId');
    verifyDingTalkRelayAuth(accountId, {
      authorization: c.req.header('Authorization'),
      channelSecret:
        c.req.header('X-Pencil-Channel-Secret') ||
        c.req.header('X-Dingtalk-Channel-Secret'),
    });

    const payload = await c.req.json();
    const message = normalizeDingTalkPayload(payload, accountId);
    if (!message) return c.json({ ok: true, ignored: true });

    // Resolve route synchronously so that any routing/auth error fails the
    // webhook synchronously (HTTP 4xx visible in relay logs). The actual
    // chat completion runs asynchronously inside enqueueSessionTask so this
    // handler returns within milliseconds — DingTalk Stream's 10s ack budget
    // is never at risk regardless of how slow the LLM turn is.
    let resolution: ReturnType<typeof resolveChannelMessage>;
    try {
      resolution = resolveChannelMessage(message);
    } catch (err) {
      // Pre-engine errors (forbidden sender, no route matched, missing api
      // key) — surface synchronously *and* try to write a card so the user
      // isn't left guessing.
      const errorText = formatChannelErrorReply(err);
      logger.warn('DingTalk route resolution failed', {
        accountId,
        chatId: message.chatId,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await new DingTalkAdapter(accountId).deliver({
          channel: 'dingtalk',
          accountId,
          chatType: message.chatType,
          chatId: message.chatId,
          threadId: message.threadId,
          text: errorText,
          replyToMessageId: message.id,
          raw: message.raw,
        });
      } catch (deliverErr) {
        logger.error('DingTalk pre-engine error delivery failed', {
          accountId,
          error: deliverErr instanceof Error ? deliverErr.message : String(deliverErr),
        });
      }
      return c.json({ ok: false, delivered: 'error', error: errorText });
    }

    // Two delivery modes:
    //   - Streaming AI card (typewriter effect): when the account has
    //     cardTemplateId + clientId/secret + robotCode all configured. We
    //     create the card up-front, then push throttled streaming frames as
    //     LLM tokens arrive. UX win: user sees "Pencil 正在回复…" within ~1s
    //     instead of waiting silently for 30–120s.
    //   - sessionWebhook fallback: legacy single-shot markdown POST. Used
    //     when streaming-card config is missing OR when card creation itself
    //     fails (so a misconfigured template never blocks replies).
    //
    // Both modes are enqueued through sessionQueues so concurrent messages
    // on the same chat are handled FIFO instead of triggering "Agent is
    // already processing" at the engine layer.
    const streamingCtx = resolveStreamingContext(accountId, message, resolution);

    enqueueSessionTask(resolution.sessionId, async () => {
      if (streamingCtx) {
        try {
          await streamDingTalkReply(streamingCtx);
          return;
        } catch (err) {
          // Card creation itself failed — fall back to the legacy path so
          // the user still gets *some* reply. (Mid-stream errors are
          // already swallowed inside streamDingTalkReply and surfaced as
          // an error-state card; only createAndDeliver failures reach here.)
          logger.warn('DingTalk streaming card unavailable, falling back to sessionWebhook', {
            accountId,
            sessionId: resolution.sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await runChannelMessageWithFallbackDelivery(accountId, message, resolution);
    });

    return c.json({ ok: true, queued: true, sessionId: resolution.sessionId });
  });

  app.post('/channels/feishu/:accountId/webhook', async (c) => {
    const accountId = c.req.param('accountId');
    const payload = await c.req.json();

    if (typeof payload?.challenge === 'string') {
      return c.json({ challenge: payload.challenge });
    }

    verifyFeishuPayload(payload, accountId);
    const message = normalizeFeishuPayload(payload, accountId);
    if (!message) return c.json({ ok: true, ignored: true });

    const resolution = resolveChannelMessage(message);
    const reply = await runChannelMessage(message, resolution);
    const adapter = new FeishuAdapter(accountId);
    await adapter.deliver({
      channel: 'feishu',
      accountId,
      chatType: message.chatType,
      chatId: message.chatId,
      threadId: message.threadId,
      text: reply,
      replyToMessageId: message.id,
    });

    return c.json({ ok: true, reply });
  });

  app.get('/channels/wechat/:accountId/webhook', (c) => {
    const accountId = c.req.param('accountId');
    verifyWeChatSignature(accountId, {
      signature: c.req.query('signature'),
      timestamp: c.req.query('timestamp'),
      nonce: c.req.query('nonce'),
    });
    return c.text(c.req.query('echostr') || 'ok');
  });

  app.post('/channels/wechat/:accountId/webhook', async (c) => {
    const accountId = c.req.param('accountId');
    verifyWeChatSignature(accountId, {
      signature: c.req.query('signature'),
      timestamp: c.req.query('timestamp'),
      nonce: c.req.query('nonce'),
    });

    const xml = await c.req.text();
    const inbound = parseWeChatTextXml(xml);
    const message = normalizeWeChatText(inbound, accountId, xml);
    const resolution = resolveChannelMessage(message);
    const reply = await runChannelMessage(message, resolution);

    return new Response(renderWeChatTextReply(inbound, reply), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  });

  app.onError((err, c) => {
    logger.error('Channel request error', {
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
    });

    if (err instanceof GatewayError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
          },
        },
        err.statusCode as 400 | 401 | 403 | 404 | 408 | 409 | 422 | 500,
      );
    }

    return c.json({ error: { code: 'internal_error', message: 'An unexpected error occurred' } }, 500);
  });

  return app;
}
