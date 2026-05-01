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
import { FeishuAdapter, normalizeFeishuPayload, verifyFeishuPayload } from './feishu/adapter.js';
import { runChannelMessage } from './gateway-client.js';
import { resolveChannelMessage } from './router.js';
import {
  normalizeWeChatText,
  parseWeChatTextXml,
  renderWeChatTextReply,
  verifyWeChatSignature,
} from './wechat/adapter.js';

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

    const resolution = resolveChannelMessage(message);
    const reply = await runChannelMessage(message, resolution);
    const adapter = new DingTalkAdapter(accountId);
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

    return c.json({ ok: true, reply });
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
