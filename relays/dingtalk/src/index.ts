/**
 * DingTalk Stream Mode → Pencil-Agent-Gateway Webhook Relay
 *
 * [WHO]  Standalone Node process; one per DingTalk app credential
 * [FROM] DingTalk Stream Mode WebSocket (`@DINGTALK_CLIENT_ID/@DINGTALK_CLIENT_SECRET`)
 * [TO]   Pencil-Agent-Gateway channel webhook
 *        (POST {GATEWAY_CHANNEL_URL}/channels/dingtalk/{DINGTALK_ACCOUNT_ID}/webhook)
 * [HERE] relays/dingtalk/src/index.ts — pure transport bridge; no engine, no model logic.
 *
 * Required env (set by ../scripts/start-relay-dingtalk.sh which sources
 * pencils/<name>/.env.dingtalk):
 *
 *   DINGTALK_CLIENT_ID         robot AppKey
 *   DINGTALK_CLIENT_SECRET     robot AppSecret
 *   DINGTALK_RELAY_SECRET      shared secret with Gateway (Authorization: Bearer)
 *   GATEWAY_CHANNEL_URL        e.g. http://127.0.0.1:18090
 *   DINGTALK_ACCOUNT_ID        URL segment, defaults to "default"
 *
 * Design notes:
 *
 *  - Gateway's normalizeDingTalkPayload accepts the dingtalk-stream message
 *    body verbatim under `{ data: ... }`. So we forward the parsed JSON
 *    as-is, without reshaping fields.
 *  - DingTalk's Stream Mode requires every message be ACKed within ~10s, or
 *    DingTalk's edge will redeliver the same event. The Gateway path
 *    (relay → channel webhook → router → engine → model) regularly takes
 *    20–120s for a real LLM turn, so we MUST decouple ACK from the forward.
 *    We immediately ACK SUCCESS and fire-and-forget the forward in the
 *    background. The reply path is independent: the Gateway's DingTalk
 *    adapter delivers the assistant text through the inbound event's
 *    `sessionWebhook`, which is valid for ~5 minutes after the original
 *    event — long enough to cover any reasonable LLM turn.
 *  - Without this decoupling, slow/failing replies cascade into:
 *      DingTalk redelivers → relay forwards again → Gateway sessions Map
 *      sees the same sessionId already busy → "Agent is already processing"
 *      → each redelivered turn still calls the model → upstream rate limits
 *      blow up → all redeliveries return 429.
 */

import { DWClient, EventAck, TOPIC_ROBOT } from 'dingtalk-stream';

interface RelayEnv {
  clientId: string;
  clientSecret: string;
  relaySecret: string;
  gatewayChannelUrl: string;
  accountId: string;
}

function loadEnv(): RelayEnv {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || !value.trim()) {
      throw new Error(
        `[relay-dingtalk] missing required env var: ${name}\n` +
          `Hint: run via ./scripts/start-relay-dingtalk.sh <pencil-name> ` +
          `which sources pencils/<name>/.env.dingtalk`,
      );
    }
    return value.trim();
  };

  return {
    clientId: required('DINGTALK_CLIENT_ID'),
    clientSecret: required('DINGTALK_CLIENT_SECRET'),
    relaySecret: required('DINGTALK_RELAY_SECRET'),
    gatewayChannelUrl:
      (process.env.GATEWAY_CHANNEL_URL || 'http://127.0.0.1:18090').replace(/\/$/, ''),
    accountId: process.env.DINGTALK_ACCOUNT_ID || 'default',
  };
}

function ts(): string {
  return new Date().toISOString();
}

async function postToGateway(env: RelayEnv, payload: unknown): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${env.gatewayChannelUrl}/channels/dingtalk/${env.accountId}/webhook`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.relaySecret}`,
        'X-Pencil-Channel-Secret': env.relaySecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Last-resort error notification: POST a markdown card directly to the
 * inbound event's sessionWebhook so the user sees *something* in the chat.
 *
 * Use this only when forwarding to the Gateway itself is impossible
 * (network failure, Gateway process down, timeout). When the Gateway
 * accepts the request and then internally fails, the Gateway's channel
 * app already delivers a friendly error card via the same sessionWebhook —
 * we do not double-deliver in that case.
 *
 * Note: sessionWebhook is signed/scoped by DingTalk and valid for ~5
 * minutes after the original event. No HMAC required.
 */
async function deliverRelayFailureToChat(payload: unknown, errorText: string): Promise<void> {
  const data = (payload as { sessionWebhook?: unknown } | null) || null;
  const webhook = typeof data?.sessionWebhook === 'string' ? data.sessionWebhook : '';
  if (!webhook) {
    console.warn(`[${ts()}] [relay-dingtalk] no sessionWebhook on event; cannot notify chat`);
    return;
  }
  const body = {
    msgtype: 'markdown',
    markdown: {
      title: 'Pencil Relay',
      text: ['**Pencil Relay 投递失败**', '', `> ${errorText}`].join('\n'),
    },
    at: { isAtAll: false },
  };
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(
        `[${ts()}] [relay-dingtalk] sessionWebhook responded ${res.status}: ${txt.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error(`[${ts()}] [relay-dingtalk] sessionWebhook POST threw`, err);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  console.log(`[${ts()}] [relay-dingtalk] starting`);
  console.log(`  clientId:   ${env.clientId}`);
  console.log(`  account:    ${env.accountId}`);
  console.log(`  forwarding: ${env.gatewayChannelUrl}/channels/dingtalk/${env.accountId}/webhook`);

  const client = new DWClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });

  // Pre-built ACK reused for every event. We always SUCCESS-ack immediately
  // (see file-header design notes). Forward result and any user-visible
  // failure is delivered out-of-band via sessionWebhook.
  const successAck = {
    code: 200,
    message: 'OK',
    headers: {},
    status: EventAck.SUCCESS,
  } as const;

  client.registerCallbackListener(TOPIC_ROBOT, async (message) => {
    // dingtalk-stream wraps the raw event body in { data: <stringified JSON> }.
    // Parse defensively — some bridge variants pass an object directly.
    let parsed: unknown = (message as { data?: unknown }).data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (err) {
        console.error(`[${ts()}] [relay-dingtalk] failed to parse message.data`, err);
        return successAck;
      }
    }

    // Fire-and-forget the forward. We MUST NOT await it before returning the
    // ack — see file header for why (DingTalk's 10s ACK budget vs typical
    // 20–120s LLM turn). Errors inside this background task are caught and
    // either logged or echoed back to the chat via sessionWebhook.
    void (async () => {
      const wireBody = { data: parsed };
      try {
        const { ok, status, body } = await postToGateway(env, wireBody);
        if (ok) {
          console.log(`[${ts()}] [relay-dingtalk] forwarded -> ${status}`);
          return;
        }
        console.warn(
          `[${ts()}] [relay-dingtalk] gateway responded ${status}: ${body.slice(0, 500)}`,
        );
        // 4xx from Gateway = our request was wrong (bad secret, malformed
        // payload, route not found). Tell the user, since the Gateway never
        // got far enough to deliver its own friendly error card.
        // 5xx from Gateway = Gateway crashed *before* its app.ts handler
        // could deliver an error card — same situation, surface it.
        // 2xx with body { ok: false, delivered: 'error' } = Gateway already
        // delivered the error card; do not double-post.
        if (status >= 400) {
          await deliverRelayFailureToChat(
            parsed,
            `Gateway HTTP ${status}: ${body.slice(0, 300) || '(empty body)'}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${ts()}] [relay-dingtalk] forward threw: ${msg}`);
        // Network/timeout failure — Gateway never saw the request. This is
        // the case where in-Gateway error delivery cannot help; relay must
        // notify the chat directly.
        await deliverRelayFailureToChat(parsed, `Gateway 不可达: ${msg}`);
      }
    })();

    return successAck;
  });

  // Block forever; SIGINT/SIGTERM unwind cleanly.
  const shutdown = (signal: string): void => {
    console.log(`[${ts()}] [relay-dingtalk] received ${signal}, exiting`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // dingtalk-stream's connect() returns a promise that never resolves — it
  // owns the WebSocket loop. Awaiting it keeps the process alive.
  await client.connect();
}

main().catch((err) => {
  console.error(`[${ts()}] [relay-dingtalk] fatal`, err);
  process.exit(1);
});
