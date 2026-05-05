/**
 * DingTalk AI card streaming pipeline
 *
 * [WHO]  Channel wrapper runtime (DingTalk webhook handler)
 * [FROM] Normalized DingTalk message + resolved channel route
 * [TO]   DingTalk OpenAPI (createAndDeliver + streaming) AND
 *        Gateway OpenAI-compatible /v1/chat/completions (stream:true SSE)
 * [HERE] src/channels/dingtalk/streaming.ts — orchestrates a single chat turn
 *        rendered as a typewriter-effect AI card
 *
 * Design:
 *  - Card is created up-front with empty content so the user immediately sees
 *    "助理回复中…" in the chat list — even if the LLM takes 30s to start
 *    emitting tokens. This is the main UX win over the sessionWebhook
 *    fallback path (silent until full reply is ready).
 *  - We consume Gateway SSE on the channel-server side and re-emit throttled
 *    full-content frames to DingTalk. Increment frequency = STREAM_INTERVAL_MS.
 *    DingTalk markdown variables require isFull=true (see openapi.streamCard
 *    docstring), so each frame carries the cumulative text.
 *  - Throttle skips intermediate frames but ALWAYS pushes the final frame
 *    with isFinalize=true, so the card can never get stuck in "inputting".
 *  - Errors translate to either:
 *      * a friendly markdown body via streamCard isError+isFinalize, or
 *      * if the card was never created, propagate to the caller so the
 *        webhook handler can fall back to sessionWebhook delivery.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../util/logger.js';
import { resolveGatewayConfig } from '../router.js';
import type { ChannelResolution, NormalizedMessage } from '../types.js';
import { getDingTalkAccount, normalizeDingTalkMarkdown } from './adapter.js';
import { createAndDeliverCard, streamCard, type DingTalkOpenApiCreds } from './openapi.js';

/**
 * Maximum interval between streaming pushes. DingTalk's streamingUpdate
 * docs recommend ≤1Hz; we use 600ms for a smoother typewriter feel while
 * staying well within the published rate envelope. Smaller values risk
 * 4xx throttling on the DingTalk side; larger values feel laggy.
 */
const STREAM_INTERVAL_MS = 600;

/**
 * Hard cap on a single streaming frame payload. DingTalk docs state per-call
 * content ≤1KB and total ≤3KB recommended for incremental updates, BUT for
 * isFull=true markdown the practical ceiling matches the legacy markdown size
 * limit. We cap at 16KB to avoid blowing up oversized streams; any reply
 * longer than this gets truncated with an indicator.
 */
const STREAM_CONTENT_CAP = 16_000;

export interface StreamingDingTalkContext {
  message: NormalizedMessage;
  resolution: ChannelResolution;
  /** Robot code for card delivery; usually equals clientId. */
  robotCode: string;
  cardTemplateId: string;
  contentKey: string;
  creds: DingTalkOpenApiCreds;
}

/**
 * Public entrypoint. Returns when the card is fully delivered (or errored).
 * Caller is expected to await this from a fire-and-forget background task —
 * the channel webhook handler must not block on it (see app.ts comments).
 *
 * Throws only when card creation itself fails (so the caller can choose to
 * fall back to sessionWebhook). All post-creation errors are absorbed and
 * surfaced as an error-state card.
 */
export async function streamDingTalkReply(ctx: StreamingDingTalkContext): Promise<void> {
  const { message, resolution, robotCode, cardTemplateId, contentKey, creds } = ctx;

  // Pull the conversation context out of the inbound payload. We trust the
  // adapter's earlier normalization for chatType, but `senderStaffId` lives
  // in the raw payload because NormalizedMessage doesn't carry it.
  const conversation = extractConversation(message);

  const outTrackId = randomUUID();
  const initialCardData: Record<string, string> = { [contentKey]: '' };

  try {
    await createAndDeliverCard({
      creds,
      robotCode,
      cardTemplateId,
      outTrackId,
      cardParamMap: initialCardData,
      conversation,
      lastMessagePreview: 'Pencil 正在回复…',
    });
  } catch (err) {
    // Card creation failed — caller should fall back to sessionWebhook.
    logger.warn('DingTalk card createAndDeliver failed; caller should fall back', {
      sessionId: resolution.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // From here on, errors update the card instead of throwing.
  const pusher = new ThrottledStreamPusher({
    creds,
    outTrackId,
    contentKey,
    intervalMs: STREAM_INTERVAL_MS,
  });

  try {
    await streamGatewayReply({
      resolution,
      message,
      onDelta: (accumulated) => pusher.schedulePush(accumulated),
    });
    await pusher.finalize();
    logger.debug('DingTalk streaming reply finalised', {
      sessionId: resolution.sessionId,
      outTrackId,
    });
  } catch (err) {
    const friendly = formatStreamingErrorBody(err);
    logger.warn('DingTalk streaming reply failed mid-flight', {
      sessionId: resolution.sessionId,
      outTrackId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await pusher.finalizeWithError(friendly);
    } catch (cardErr) {
      logger.error('DingTalk error-card finalize also failed', {
        outTrackId,
        error: cardErr instanceof Error ? cardErr.message : String(cardErr),
      });
    }
  }
}

interface StreamGatewayOptions {
  resolution: ChannelResolution;
  message: NormalizedMessage;
  onDelta: (accumulatedText: string) => void;
}

/**
 * Hit the Gateway's OpenAI-compatible chat-completions endpoint with
 * stream:true and parse SSE deltas. We deliberately speak HTTP rather than
 * importing the engine directly so the channel server stays decoupled from
 * AgentRegistry (matches the architecture in gateway-client.ts).
 */
async function streamGatewayReply(opts: StreamGatewayOptions): Promise<void> {
  const gateway = resolveGatewayConfig(opts.resolution.route);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gateway.timeoutMs ?? 120000);

  try {
    const res = await fetch(`${gateway.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.resolution.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Pencil-Session': opts.resolution.sessionId,
      },
      body: JSON.stringify({
        model: opts.resolution.agentModel,
        messages: [{ role: 'user', content: opts.message.text }],
        stream: true,
        session_id: opts.resolution.sessionId,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gateway chat request failed: ${res.status} ${body.slice(0, 500)}`);
    }

    let accumulated = '';
    for await (const chunk of iterateSseDeltas(res.body)) {
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.delta) {
        accumulated += chunk.delta;
        opts.onDelta(accumulated);
      }
      if (chunk.done) break;
    }
    if (!accumulated) {
      throw new Error('Gateway streamed no assistant content');
    }
    // Push one last frame with the final accumulated text so finalize() in
    // the caller can synchronously upgrade it to isFinalize=true.
    opts.onDelta(accumulated);
  } finally {
    clearTimeout(timeout);
  }
}

interface SseChunk {
  delta?: string;
  done?: boolean;
  error?: string;
}

/**
 * Minimal SSE parser tuned for OpenAI-compatible chat-completion streams.
 * Yields one SseChunk per `data:` line. Tolerates split frames inside a TCP
 * packet boundary by buffering on `\n\n`.
 */
async function* iterateSseDeltas(stream: ReadableStream<Uint8Array>): AsyncIterable<SseChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIdx: number;
      while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const dataLine = event
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          yield { done: true };
          return;
        }
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            error?: { message?: string };
          };
          if (obj.error?.message) {
            yield { error: obj.error.message };
            return;
          }
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
          if (obj.choices?.[0]?.finish_reason && obj.choices[0].finish_reason !== null) {
            yield { done: true };
            return;
          }
        } catch {
          // Malformed frame — skip rather than abort the whole stream. A
          // single dropped delta is preferable to ending the typewriter
          // abruptly mid-sentence.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Throttled pusher: coalesces rapid onDelta calls into ≤1 streamCard call
 * per intervalMs. The latest content is always remembered so the next push
 * (or finalize) sees the full text.
 */
class ThrottledStreamPusher {
  private latestContent = '';
  private lastPushedContent = '';
  private lastPushAt = 0;
  private pendingTimer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> = Promise.resolve();
  private finalised = false;

  constructor(
    private readonly opts: {
      creds: DingTalkOpenApiCreds;
      outTrackId: string;
      contentKey: string;
      intervalMs: number;
    },
  ) {}

  schedulePush(content: string): void {
    if (this.finalised) return;
    this.latestContent = capContent(content);
    const now = Date.now();
    const elapsed = now - this.lastPushAt;

    if (this.pendingTimer) return; // a flush is already queued

    if (elapsed >= this.opts.intervalMs) {
      this.flush().catch(() => {
        /* logged inside flush */
      });
      return;
    }

    const wait = this.opts.intervalMs - elapsed;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.flush().catch(() => {
        /* logged inside flush */
      });
    }, wait);
  }

  async finalize(): Promise<void> {
    this.finalised = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    await this.inflight;
    // Always send a finalize frame even if the last throttle window already
    // pushed identical content — the AI card needs `isFinalize=true` to
    // transition out of "inputting" state.
    await streamCard({
      creds: this.opts.creds,
      outTrackId: this.opts.outTrackId,
      key: this.opts.contentKey,
      content: normalizeDingTalkMarkdown(this.latestContent || ' '),
      isFinalize: true,
    });
  }

  async finalizeWithError(errorMarkdown: string): Promise<void> {
    this.finalised = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    await this.inflight.catch(() => undefined);
    // If we already pushed partial content, keep it so the user sees the
    // partial answer plus the error trailer; otherwise just show the error.
    const body = this.lastPushedContent
      ? `${this.lastPushedContent}\n\n---\n\n${errorMarkdown}`
      : errorMarkdown;
    await streamCard({
      creds: this.opts.creds,
      outTrackId: this.opts.outTrackId,
      key: this.opts.contentKey,
      content: normalizeDingTalkMarkdown(capContent(body)),
      isFinalize: true,
      isError: true,
    });
  }

  /**
   * Push the latest accumulated content if it's changed since the last push.
   * Same-content windows are skipped — finalize() always sends its own frame
   * regardless, so a no-op throttle window can never leave the card stuck in
   * "inputting" state.
   */
  private flush(): Promise<void> {
    const content = this.latestContent;
    if (content === this.lastPushedContent) return Promise.resolve();
    this.lastPushAt = Date.now();
    this.lastPushedContent = content;
    // Chain pushes through `inflight` so we never have two streamCard calls
    // in flight at the same outTrackId — ordering matters for the renderer.
    this.inflight = this.inflight
      .catch(() => undefined)
      .then(() =>
        streamCard({
          creds: this.opts.creds,
          outTrackId: this.opts.outTrackId,
          key: this.opts.contentKey,
          content: normalizeDingTalkMarkdown(content || ' '),
          isFinalize: false,
        }),
      )
      .catch((err) => {
        // streamCard already retries 429/5xx internally; reaching here means
        // either non-retryable (auth/template) or retries exhausted. We log
        // and swallow — the next throttle window will try again with newer
        // content, and finalize() force-sends a final frame at end-of-stream.
        logger.warn('DingTalk streamCard push failed (final attempt)', {
          outTrackId: this.opts.outTrackId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return this.inflight;
  }
}

function capContent(text: string): string {
  if (text.length <= STREAM_CONTENT_CAP) return text;
  return `${text.slice(0, STREAM_CONTENT_CAP)}\n\n…（已截断，全文超出钉钉卡片单帧上限）`;
}

interface ConversationContext {
  type: 'dm' | 'group';
  conversationId: string;
  userId?: string;
}

function extractConversation(message: NormalizedMessage): ConversationContext {
  const raw = (message.raw ?? {}) as Record<string, unknown>;
  const userId =
    typeof raw.senderStaffId === 'string'
      ? raw.senderStaffId
      : typeof raw.sender_staff_id === 'string'
        ? raw.sender_staff_id
        : typeof raw.senderId === 'string'
          ? raw.senderId
          : undefined;

  // Prefer the original conversationId off the raw payload — for DMs,
  // normalizeDingTalkPayload falls back to senderId when conversationId is
  // missing, but DingTalk's openSpaceId expects the actual conversation id
  // (the IM_ROBOT.<id> form addresses the 1:1 thread, not the user).
  const rawConversationId =
    typeof raw.conversationId === 'string'
      ? raw.conversationId
      : typeof raw.conversation_id === 'string'
        ? raw.conversation_id
        : message.chatId;

  return {
    type: message.chatType === 'group' ? 'group' : 'dm',
    conversationId: rawConversationId,
    userId,
  };
}

function formatStreamingErrorBody(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/Agent is already processing/i.test(raw)) {
    return [
      '**Pencil 正在思考上一条消息**',
      '',
      '同一个会话里我一次只处理一条请求，请等当前回复完成后再发。',
    ].join('\n');
  }
  if (/rate.?limit|429|too many requests|RPM|TPM|usage limit/i.test(raw)) {
    return [
      '**Pencil 触发模型限流**',
      '',
      '上游模型暂时拒绝了请求（可能是 RPM/TPM 配额）。请稍后重试，或在 settings.json 切到其他 provider。',
      '',
      `> ${raw.slice(0, 300)}`,
    ].join('\n');
  }
  if (/No model selected|No API key found|not found for provider/i.test(raw)) {
    return [
      '**Pencil 模型配置异常**',
      '',
      '当前 pencil 找不到可用模型或 API key。请检查 `~/.pencils/<name>/settings.json` 与 `auth.json`。',
      '',
      `> ${raw.slice(0, 300)}`,
    ].join('\n');
  }
  const trimmed = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  return ['**Pencil 处理失败**', '', `> ${trimmed}`].join('\n');
}

/**
 * Decide whether streaming-card delivery is enabled for the given accountId.
 * Returns the resolved context (creds + template) or null if any required
 * piece of config is missing — caller should then use the sessionWebhook
 * fallback path.
 */
export function resolveStreamingContext(
  accountId: string,
  message: NormalizedMessage,
  resolution: ChannelResolution,
): StreamingDingTalkContext | null {
  const account = getDingTalkAccount(accountId);
  // Explicit opt-out wins.
  if (account.streamingEnabled === false) return null;

  // `nonEmpty` treats both undefined and empty string as "not configured".
  // Empty string occurs when config.json uses the soft `${VAR:-}` form and the
  // env var isn't set — see interpolateEnv docstring. Without this, a pencil
  // with `cardTemplateId: ""` would try to call createAndDeliver with an
  // empty template id and fail at runtime instead of falling back gracefully.
  const cardTemplateId = nonEmpty(account.cardTemplateId);
  const clientId = nonEmpty(account.clientId) || nonEmpty(process.env.DINGTALK_CLIENT_ID);
  const clientSecret = nonEmpty(account.clientSecret) || nonEmpty(process.env.DINGTALK_CLIENT_SECRET);
  const robotCode = nonEmpty(account.robotCode) || clientId;
  const contentKey = nonEmpty(account.cardContentKey) || 'content';

  if (!cardTemplateId || !clientId || !clientSecret || !robotCode) return null;

  return {
    message,
    resolution,
    cardTemplateId,
    contentKey,
    robotCode,
    creds: { clientId, clientSecret },
  };
}

function nonEmpty(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
