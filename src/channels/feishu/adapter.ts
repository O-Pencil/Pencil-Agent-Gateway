/**
 * Feishu Channel Adapter
 *
 * [WHO]  Feishu channel wrapper
 * [FROM] Feishu event callback payloads
 * [TO]  NormalizedMessage and Feishu message reply API
 * [HERE] Feishu-specific webhook parsing, verification token checks, and text delivery
 */

import { EngineError, ForbiddenError, UnsupportedFeatureError } from '../../util/errors.js';
import { getChannelsConfig } from '../router.js';
import type { ChannelAdapter, FeishuAccountConfig, NormalizedMessage, OutboundMessage } from '../types.js';

interface FeishuPayload {
  challenge?: string;
  token?: string;
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
}

interface TenantTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu';

  constructor(private readonly accountId: string) {}

  async deliver(message: OutboundMessage): Promise<void> {
    const account = getFeishuAccount(this.accountId);
    if (!account.appId || !account.appSecret) {
      return;
    }
    if (!message.replyToMessageId) {
      throw new UnsupportedFeatureError('Feishu delivery requires replyToMessageId in v0.1');
    }

    const token = await fetchTenantAccessToken(account);
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(message.replyToMessageId)}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msg_type: 'text',
          content: JSON.stringify({ text: message.text }),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new EngineError(`Feishu reply failed: ${response.status} ${body}`);
    }
  }
}

export function getFeishuAccount(accountId: string): FeishuAccountConfig {
  return getChannelsConfig().accounts?.feishu?.[accountId] ?? {};
}

export function verifyFeishuPayload(payload: FeishuPayload, accountId: string): void {
  const expectedToken = getFeishuAccount(accountId).verificationToken;
  if (expectedToken && payload.token !== expectedToken) {
    throw new ForbiddenError('Invalid Feishu verification token');
  }
}

export function normalizeFeishuPayload(payload: FeishuPayload, accountId: string): NormalizedMessage | null {
  const message = payload.event?.message;
  if (!message) return null;
  if (message.message_type !== 'text') {
    throw new UnsupportedFeatureError(`Feishu message_type '${message.message_type}' is not supported in v0.1`);
  }

  const senderId =
    payload.event?.sender?.sender_id?.open_id ||
    payload.event?.sender?.sender_id?.user_id ||
    payload.event?.sender?.sender_id?.union_id;
  const chatId = message.chat_id;
  const messageId = message.message_id;
  const text = parseFeishuText(message.content);

  if (!senderId || !chatId || !messageId || !text) {
    throw new UnsupportedFeatureError('Feishu text event is missing sender, chat, message id, or text');
  }

  return {
    id: messageId,
    channel: 'feishu',
    accountId,
    senderId,
    chatType: mapFeishuChatType(message.chat_type),
    chatId,
    text,
    receivedAt: Date.now(),
    raw: payload,
  };
}

function parseFeishuText(content: string | undefined): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? '';
  } catch {
    return content.trim();
  }
}

function mapFeishuChatType(chatType: string | undefined): NormalizedMessage['chatType'] {
  if (chatType === 'p2p') return 'dm';
  if (chatType === 'group') return 'group';
  return 'channel';
}

async function fetchTenantAccessToken(account: FeishuAccountConfig): Promise<string> {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: account.appId,
      app_secret: account.appSecret,
    }),
  });
  const body = await response.json().catch(() => ({})) as TenantTokenResponse;
  if (!response.ok || !body.tenant_access_token) {
    throw new EngineError(`Feishu tenant token failed: ${body.msg || response.statusText}`);
  }
  return body.tenant_access_token;
}
