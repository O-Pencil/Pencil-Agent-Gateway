/**
 * DingTalk inbound deduplication
 *
 * [WHO]  Channel webhook handler
 * [FROM] Duplicate Stream callbacks or edge redelivery within a tight window
 * [TO]   Suppress second enqueue of the same user-visible turn
 * [HERE] Process-local fingerprint map — same chat/sender/normalized text within
 *        WINDOW_MS → ignore; stable platform message ids dedupe for longer TTL.
 */

import type { NormalizedMessage } from '../types.js';

/** Text fingerprint window — DingTalk sometimes delivers duplicates several seconds apart. */
const WINDOW_MS = 12000;

/** When payload exposes a stable message id, suppress retries/redelivery longer than text window. */
const STABLE_ID_TTL_MS = 180000;

const firstSeen = new Map<string, number>();
const stableIds = new Map<string, number>();

function prune(now: number): void {
  for (const [k, t] of firstSeen) {
    if (now - t > WINDOW_MS * 4) firstSeen.delete(k);
  }
  for (const [k, t] of stableIds) {
    if (now - t > STABLE_ID_TTL_MS * 2) stableIds.delete(k);
  }
}

/**
 * Collapse whitespace / zero-width chars so two deliveries that differ only in
 * formatting still match the same fingerprint.
 */
export function normalizeInboundTextForDedup(text: string): string {
  return text.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

function fingerprint(accountId: string, message: NormalizedMessage): string {
  const body = normalizeInboundTextForDedup(message.text);
  return `${accountId}\t${message.senderId}\t${message.chatId}\t${body}`;
}

/**
 * DingTalk Stream payloads usually expose one of these on the inner object.
 */
function extractStablePlatformMessageId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const keys = ['messageId', 'message_id', 'msgId', 'msg_id', 'trackId', 'msgUuid', 'messageUuid'];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.length >= 6) return s;
    }
  }
  return undefined;
}

/**
 * Returns true when this inbound should be processed; false when it looks like
 * a duplicate (same stable message id, or same normalized fingerprint within WINDOW_MS).
 */
export function shouldProcessDingTalkInbound(accountId: string, message: NormalizedMessage): boolean {
  const now = Date.now();
  prune(now);

  const stable = extractStablePlatformMessageId(message.raw);
  if (stable) {
    const key = `${accountId}:${stable}`;
    const prev = stableIds.get(key);
    if (prev !== undefined && now - prev < STABLE_ID_TTL_MS) {
      return false;
    }
    stableIds.set(key, now);
    return true;
  }

  const fp = fingerprint(accountId, message);
  const prev = firstSeen.get(fp);
  if (prev !== undefined && now - prev < WINDOW_MS) {
    return false;
  }
  firstSeen.set(fp, now);
  return true;
}
