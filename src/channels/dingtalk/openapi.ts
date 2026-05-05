/**
 * DingTalk OpenAPI client (AI card subset)
 *
 * [WHO]  Channel wrapper runtime
 * [FROM] DingTalk webhook handler when streaming-card delivery is enabled
 * [TO]   DingTalk OpenAPI v1.0 (`api.dingtalk.com`) and legacy gettoken (`oapi.dingtalk.com`)
 * [HERE] src/channels/dingtalk/openapi.ts — minimal fetch wrapper covering:
 *          - access_token acquisition + in-memory caching with proactive refresh
 *          - card instance creation/delivery (POST /v1.0/card/instances/createAndDeliver)
 *          - streaming content updates (PUT /v1.0/card/streaming)
 *
 * Why hand-rolled instead of pulling @alicloud/dingtalk:
 *  - The Aliyun TypeScript SDK ships a Tea runtime that bundles >2MB of
 *    transitively-imported services we don't need; for three endpoints a fetch
 *    wrapper is clearer and lighter.
 *  - We need fine-grained control over error→user-card translation (see
 *    streaming.ts), which the SDK obscures behind TeaException.
 *
 * Token lifecycle:
 *  - DingTalk's gettoken returns expires_in≈7200s. We refresh at 75% lifetime
 *    so a long-running relay never serves an expired token.
 *  - Cache is keyed by clientId so a single Gateway hosting multiple DingTalk
 *    accounts (different robots) keeps separate tokens.
 *  - Cache lives in process memory only — a Gateway restart re-fetches.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../util/logger.js';
import { EngineError } from '../../util/errors.js';

const GETTOKEN_URL = 'https://oapi.dingtalk.com/gettoken';
const OPENAPI_BASE = 'https://api.dingtalk.com';

interface CachedToken {
  token: string;
  // Absolute epoch-ms when we should refresh. Set to 75% of expires_in.
  refreshAt: number;
}

const tokenCache = new Map<string, CachedToken>();
// In-flight token fetches keyed by clientId, so concurrent callers share one
// network roundtrip instead of stampeding gettoken.
const inflightToken = new Map<string, Promise<string>>();

interface GettokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

export async function getDingTalkAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = tokenCache.get(clientId);
  const now = Date.now();
  if (cached && cached.refreshAt > now) return cached.token;

  const inflight = inflightToken.get(clientId);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
    const url = `${GETTOKEN_URL}?appkey=${encodeURIComponent(clientId)}&appsecret=${encodeURIComponent(clientSecret)}`;
    const res = await fetch(url, { method: 'GET' });
    const body = (await res.json().catch(() => ({}))) as GettokenResponse;
    if (!res.ok || body.errcode !== 0 || !body.access_token) {
      throw new EngineError(
        `DingTalk gettoken failed: HTTP ${res.status} errcode=${body.errcode} ${body.errmsg || ''}`.trim(),
      );
    }
    const ttlMs = Math.max(60_000, (body.expires_in ?? 7200) * 1000);
    tokenCache.set(clientId, {
      token: body.access_token,
      refreshAt: Date.now() + Math.floor(ttlMs * 0.75),
    });
    logger.debug('DingTalk access token refreshed', {
      clientId,
      ttlSeconds: body.expires_in,
    });
    return body.access_token;
  })()
    .finally(() => {
      inflightToken.delete(clientId);
    });

  inflightToken.set(clientId, fetchPromise);
  return fetchPromise;
}

export interface DingTalkOpenApiCreds {
  clientId: string;
  clientSecret: string;
}

export interface CreateAndDeliverCardOptions {
  creds: DingTalkOpenApiCreds;
  /** Robot code from DingTalk console; for stream-mode robots equals clientId. */
  robotCode: string;
  /** Card template id ending in `.schema` (created in DingTalk card platform). */
  cardTemplateId: string;
  /** Stable identifier you assign per chat turn; reused by streamCard. */
  outTrackId: string;
  /**
   * Variables passed into the template (cardData.cardParamMap). For an AI
   * card with a streaming markdown variable named `content`, pass `{ content: '' }`
   * — the streaming variable can be empty here because streamCard fills it.
   */
  cardParamMap: Record<string, string>;
  /** Inbound DingTalk conversation context — used to derive openSpaceId. */
  conversation: {
    /** From the inbound event: `conversationType` ('1'=DM, '2'=group). */
    type: 'dm' | 'group';
    /** Inbound `conversationId` (group id or 1:1 chat id). */
    conversationId: string;
    /** Required for DM delivery: receiver staffId from inbound `senderStaffId`/`senderId`. */
    userId?: string;
  };
  /**
   * Last-message preview shown in the chat list before the card opens.
   * Optional but improves UX (e.g. "Pencil 正在思考…").
   */
  lastMessagePreview?: string;
}

interface CreateAndDeliverResponseBody {
  result?: { outTrackId?: string };
  // Error envelope used by api.dingtalk.com v1.0
  code?: string;
  message?: string;
  requestId?: string;
}

export async function createAndDeliverCard(opts: CreateAndDeliverCardOptions): Promise<void> {
  const token = await getDingTalkAccessToken(opts.creds.clientId, opts.creds.clientSecret);

  // openSpaceId encodes which surface DingTalk should render the card in.
  // Format defined by DingTalk card platform; do NOT URL-escape the dots.
  // See: https://open.dingtalk.com/document/orgapp/create-and-deliver-cards
  const openSpaceId =
    opts.conversation.type === 'group'
      ? `dtv1.card//IM_GROUP.${opts.conversation.conversationId}`
      : `dtv1.card//IM_ROBOT.${opts.conversation.conversationId}`;

  const body: Record<string, unknown> = {
    outTrackId: opts.outTrackId,
    cardTemplateId: opts.cardTemplateId,
    cardData: { cardParamMap: opts.cardParamMap },
    openSpaceId,
    // userIdType=1 → staffId (default for in-org robots). 2 = unionId.
    userIdType: 1,
    // STREAM = card-instance lifecycle managed via Stream Mode (no HTTP card
    // callbacks). Matches our relay topology.
    callbackType: 'STREAM',
  };

  if (opts.conversation.type === 'group') {
    body.imGroupOpenDeliverModel = { robotCode: opts.robotCode };
    body.imGroupOpenSpaceModel = {
      supportForward: true,
      ...(opts.lastMessagePreview
        ? { lastMessageI18n: { ZH_CN: opts.lastMessagePreview } }
        : {}),
    };
  } else {
    if (!opts.conversation.userId) {
      throw new EngineError('createAndDeliverCard: DM delivery requires conversation.userId');
    }
    body.imRobotOpenDeliverModel = {
      spaceType: 'IM_ROBOT',
      robotCode: opts.robotCode,
      userIds: [opts.conversation.userId],
    };
    body.imRobotOpenSpaceModel = {
      supportForward: true,
      ...(opts.lastMessagePreview
        ? { lastMessageI18n: { ZH_CN: opts.lastMessagePreview } }
        : {}),
    };
  }

  const res = await fetch(`${OPENAPI_BASE}/v1.0/card/instances/createAndDeliver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let parsed: CreateAndDeliverResponseBody = {};
    try {
      parsed = JSON.parse(text) as CreateAndDeliverResponseBody;
    } catch {
      // ignore
    }
    throw new EngineError(
      `DingTalk createAndDeliver failed: HTTP ${res.status} code=${parsed.code ?? '?'} requestId=${parsed.requestId ?? '?'} ${parsed.message || text.slice(0, 300)}`,
    );
  }
  logger.debug('DingTalk card delivered', {
    outTrackId: opts.outTrackId,
    chatType: opts.conversation.type,
  });
}

export interface StreamCardOptions {
  creds: DingTalkOpenApiCreds;
  outTrackId: string;
  /** Variable key inside the template — defaults to 'content'. */
  key?: string;
  /** Full markdown content (must be the *complete* value, not a delta — see notes). */
  content: string;
  /** When true, transitions card to "completed" status. Last frame must set this. */
  isFinalize?: boolean;
  /** When true, transitions card to "error" status (still finalises the stream). */
  isError?: boolean;
}

interface StreamingUpdateResponseBody {
  code?: string;
  message?: string;
  requestId?: string;
}

/**
 * 429 / 5xx are transient — retry with bounded exponential backoff. 4xx other
 * than 429 (auth, schema, template not found) are caller errors and should
 * fail fast so the streaming pipeline can finalize the card with an error
 * frame instead of looping forever.
 */
const STREAM_CARD_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const STREAM_CARD_MAX_ATTEMPTS = 3;
const STREAM_CARD_BASE_BACKOFF_MS = 200;

function streamCardBackoffMs(attempt: number): number {
  // 200ms, 400ms — bounded so the card never sits inputting longer than ~1s
  // due to retries alone. Caller's outer throttle (~600ms) keeps the actual
  // push rate well within DingTalk's published 1Hz envelope.
  return STREAM_CARD_BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

/**
 * Push one frame of streaming content. For markdown variables, every call MUST
 * carry the *complete* accumulated text and we set isFull=true — DingTalk's
 * AI card markdown renderer does not support incremental concatenation.
 *
 * Recommended call pattern from caller's perspective:
 *  - throttle to ≤1 call per 500–1000 ms while tokens stream in (rate-limit
 *    protection on DingTalk side; sustained higher rates cause 4xx)
 *  - always call once with isFinalize=true at end-of-stream so the card
 *    transitions out of "inputting" state, regardless of whether the last
 *    throttle window already pushed the same content
 *
 * Internally retries on 429 / 5xx up to 3 attempts with 200ms+400ms backoff
 * so a single transient throttle from DingTalk doesn't drop a frame and leave
 * the card stuck on stale text.
 */
export async function streamCard(opts: StreamCardOptions): Promise<void> {
  const token = await getDingTalkAccessToken(opts.creds.clientId, opts.creds.clientSecret);
  const body = {
    outTrackId: opts.outTrackId,
    guid: randomUUID(),
    key: opts.key ?? 'content',
    content: opts.content,
    isFull: true,
    isFinalize: Boolean(opts.isFinalize),
    ...(opts.isError ? { isError: true } : {}),
  };

  let lastErr: EngineError | undefined;
  for (let attempt = 1; attempt <= STREAM_CARD_MAX_ATTEMPTS; attempt += 1) {
    const res = await fetch(`${OPENAPI_BASE}/v1.0/card/streaming`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      if (attempt > 1) {
        logger.info('DingTalk streamCard recovered after retry', {
          outTrackId: opts.outTrackId,
          attempt,
          isFinalize: body.isFinalize,
        });
      }
      return;
    }

    const text = await res.text().catch(() => '');
    let parsed: StreamingUpdateResponseBody = {};
    try {
      parsed = JSON.parse(text) as StreamingUpdateResponseBody;
    } catch {
      // ignore — keep raw text for the error message
    }

    lastErr = new EngineError(
      `DingTalk streamCard failed: HTTP ${res.status} code=${parsed.code ?? '?'} requestId=${parsed.requestId ?? '?'} ${parsed.message || text.slice(0, 300)}`,
    );

    const retryable =
      STREAM_CARD_RETRYABLE_STATUSES.has(res.status) && attempt < STREAM_CARD_MAX_ATTEMPTS;
    if (!retryable) break;

    logger.warn('DingTalk streamCard transient error — retrying', {
      outTrackId: opts.outTrackId,
      attempt,
      status: res.status,
      requestId: parsed.requestId,
      backoffMs: streamCardBackoffMs(attempt),
    });
    await new Promise((r) => setTimeout(r, streamCardBackoffMs(attempt)));
  }

  throw lastErr ?? new EngineError('DingTalk streamCard failed for unknown reason');
}
