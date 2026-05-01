/**
 * DingTalk Channel Adapter
 *
 * [WHO]  DingTalk channel wrapper
 * [FROM] DingTalk Stream Mode relay, MCP connector, or compatible HTTP bridge payloads
 * [TO]  NormalizedMessage and DingTalk session webhook markdown replies
 * [HERE] DingTalk-specific relay auth, payload parsing, mention gating, and text delivery
 */

import { EngineError, ForbiddenError, UnsupportedFeatureError } from '../../util/errors.js';
import { getChannelsConfig } from '../router.js';
import type { ChannelAdapter, DingTalkAccountConfig, NormalizedMessage, OutboundMessage } from '../types.js';

const DINGTALK_WEBHOOK_RE = /^https:\/\/(?:api|oapi)\.dingtalk\.com\//;
const MAX_DINGTALK_MARKDOWN_LENGTH = 20000;

interface DingTalkPayload {
  data?: unknown;
  message?: unknown;
  event?: unknown;
  text?: unknown;
  richText?: unknown;
  richTextContent?: unknown;
  sessionWebhook?: string;
  session_webhook?: string;
  messageId?: string;
  message_id?: string;
  msgId?: string;
  msgtype?: string;
  messageType?: string;
  message_type?: string;
  conversationId?: string;
  conversation_id?: string;
  conversationType?: string | number;
  conversation_type?: string | number;
  senderId?: string;
  sender_id?: string;
  isInAtList?: boolean;
  is_in_at_list?: boolean;
  createAt?: number | string;
  create_at?: number | string;
}

export interface DingTalkRelayAuthInput {
  authorization?: string;
  channelSecret?: string;
}

export class DingTalkAdapter implements ChannelAdapter {
  readonly id = 'dingtalk';

  constructor(_accountId: string) {}

  async deliver(message: OutboundMessage): Promise<void> {
    const payload = unwrapDingTalkPayload(message.raw);
    const sessionWebhook = readString(payload, 'sessionWebhook', 'session_webhook');

    if (!sessionWebhook || !DINGTALK_WEBHOOK_RE.test(sessionWebhook)) {
      throw new UnsupportedFeatureError('DingTalk delivery requires a valid sessionWebhook from the inbound event');
    }

    const response = await fetch(sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: 'PencilAgent',
          text: normalizeDingTalkMarkdown(message.text).slice(0, MAX_DINGTALK_MARKDOWN_LENGTH),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new EngineError(`DingTalk reply failed: ${response.status} ${body}`);
    }
  }
}

export function getDingTalkAccount(accountId: string): DingTalkAccountConfig {
  return getChannelsConfig().accounts?.dingtalk?.[accountId] ?? {};
}

export function verifyDingTalkRelayAuth(accountId: string, input: DingTalkRelayAuthInput): void {
  const expectedSecret = getDingTalkAccount(accountId).webhookSecret;
  if (!expectedSecret) return;

  const bearer = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer || input.channelSecret;
  if (provided !== expectedSecret) {
    throw new ForbiddenError('Invalid DingTalk relay secret');
  }
}

export function normalizeDingTalkPayload(payload: unknown, accountId: string): NormalizedMessage | null {
  const data = unwrapDingTalkPayload(payload);
  if (!data) return null;

  const messageType = readString(data, 'messageType', 'message_type', 'msgtype');
  if (messageType && !['text', 'richText'].includes(messageType)) {
    throw new UnsupportedFeatureError(`DingTalk message type '${messageType}' is not supported in v0.1`);
  }

  const text = extractDingTalkText(data);
  if (!text) {
    throw new UnsupportedFeatureError('DingTalk event did not contain text content');
  }

  const conversationId = readString(data, 'conversationId', 'conversation_id');
  const senderId = readString(data, 'senderId', 'sender_id');
  const messageId = readString(data, 'messageId', 'message_id', 'msgId') || `${Date.now()}`;
  const conversationType = readString(data, 'conversationType', 'conversation_type');
  const isGroup = conversationType === '2';
  const chatId = conversationId || senderId;

  if (!senderId || !chatId) {
    throw new UnsupportedFeatureError('DingTalk text event is missing sender or conversation identity');
  }

  if (isGroup && !shouldProcessDingTalkGroupMessage(data, accountId, chatId, text)) {
    return null;
  }

  return {
    id: messageId,
    channel: 'dingtalk',
    accountId,
    senderId,
    chatType: isGroup ? 'group' : 'dm',
    chatId,
    text,
    receivedAt: parseDingTalkTimestamp(readString(data, 'createAt', 'create_at')),
    raw: data,
  };
}

export function extractDingTalkText(payload: DingTalkPayload): string {
  const text = payload.text;
  if (isRecord(text)) {
    const content = readString(text, 'content').trim();
    if (content) return content;
  }
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  const richText = payload.richTextContent ?? payload.richText;
  if (!isRecord(richText)) return '';

  const richTextList = richText.richTextList ?? richText.rich_text_list ?? richText;
  if (!Array.isArray(richTextList)) return '';

  return richTextList
    .map((item) => (isRecord(item) ? readString(item, 'text', 'content') : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function normalizeDingTalkMarkdown(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i] ?? '';
    const isNumberedList = /^\d+\.\s/.test(line.trim());
    const previous = lines[i - 1] ?? '';
    if (isNumberedList && i > 0 && previous.trim() && !/^\d+\.\s/.test(previous.trim())) {
      output.push('');
    }
    if (line.trim().startsWith('```') && line !== line.trimStart()) {
      line = line.trimStart();
    }
    output.push(line);
  }
  return output.join('\n');
}

function shouldProcessDingTalkGroupMessage(
  payload: DingTalkPayload,
  accountId: string,
  chatId: string,
  text: string,
): boolean {
  const account = getDingTalkAccount(accountId);
  if (account.freeResponseChatIds?.includes(chatId)) return true;
  if (!account.requireMention) return true;
  if (payload.isInAtList || payload.is_in_at_list) return true;

  return (account.mentionPatterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(text);
    } catch {
      return false;
    }
  });
}

function unwrapDingTalkPayload(payload: unknown): DingTalkPayload | null {
  if (typeof payload === 'string') {
    try {
      return unwrapDingTalkPayload(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  if (!isRecord(payload)) return null;

  const nested = payload.data ?? payload.message ?? payload.event;
  if (nested && nested !== payload) {
    const unwrapped = unwrapDingTalkPayload(nested);
    if (unwrapped) return unwrapped;
  }

  return payload as DingTalkPayload;
}

function parseDingTalkTimestamp(value: string): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Date.now();
}

function readString(source: unknown, ...keys: string[]): string {
  if (!isRecord(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
