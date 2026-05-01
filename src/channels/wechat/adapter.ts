/**
 * WeChat Channel Adapter
 *
 * [WHO]  WeChat channel wrapper
 * [FROM] WeChat official account webhook XML
 * [TO]  NormalizedMessage and synchronous WeChat XML text replies
 * [HERE] WeChat-specific signature verification, XML parsing, and text response rendering
 */

import { createHash } from 'node:crypto';
import { ForbiddenError, UnsupportedFeatureError } from '../../util/errors.js';
import { getChannelsConfig } from '../router.js';
import type { ChannelAdapter, NormalizedMessage, OutboundMessage, WeChatAccountConfig } from '../types.js';

export interface WeChatSignatureInput {
  signature?: string;
  timestamp?: string;
  nonce?: string;
}

export interface ParsedWeChatText {
  toUserName: string;
  fromUserName: string;
  msgType: string;
  content: string;
  msgId: string;
}

export class WeChatAdapter implements ChannelAdapter {
  readonly id = 'wechat';

  async deliver(_message: OutboundMessage): Promise<void> {
    // WeChat official account text replies are returned synchronously from the
    // webhook handler in v0.1. Async customer-service delivery can be added as
    // a later platform-specific extension.
  }
}

export function getWeChatAccount(accountId: string): WeChatAccountConfig {
  return getChannelsConfig().accounts?.wechat?.[accountId] ?? {};
}

export function verifyWeChatSignature(accountId: string, input: WeChatSignatureInput): void {
  const token = getWeChatAccount(accountId).token;
  if (!token) return;
  if (!input.signature || !input.timestamp || !input.nonce) {
    throw new ForbiddenError('Missing WeChat signature fields');
  }

  const expected = createHash('sha1')
    .update([token, input.timestamp, input.nonce].sort().join(''))
    .digest('hex');

  if (expected !== input.signature) {
    throw new ForbiddenError('Invalid WeChat signature');
  }
}

export function parseWeChatTextXml(xml: string): ParsedWeChatText {
  const msgType = readXmlTag(xml, 'MsgType');
  if (msgType !== 'text') {
    throw new UnsupportedFeatureError(`WeChat MsgType '${msgType}' is not supported in v0.1`);
  }

  const parsed = {
    toUserName: readXmlTag(xml, 'ToUserName'),
    fromUserName: readXmlTag(xml, 'FromUserName'),
    msgType,
    content: readXmlTag(xml, 'Content').trim(),
    msgId: readXmlTag(xml, 'MsgId') || `${Date.now()}`,
  };

  if (!parsed.toUserName || !parsed.fromUserName || !parsed.content) {
    throw new UnsupportedFeatureError('WeChat text XML is missing required fields');
  }

  return parsed;
}

export function normalizeWeChatText(parsed: ParsedWeChatText, accountId: string, raw: string): NormalizedMessage {
  return {
    id: parsed.msgId,
    channel: 'wechat',
    accountId,
    senderId: parsed.fromUserName,
    chatType: 'dm',
    chatId: parsed.fromUserName,
    text: parsed.content,
    receivedAt: Date.now(),
    raw,
  };
}

export function renderWeChatTextReply(inbound: ParsedWeChatText, text: string): string {
  return [
    '<xml>',
    `<ToUserName><![CDATA[${inbound.fromUserName}]]></ToUserName>`,
    `<FromUserName><![CDATA[${inbound.toUserName}]]></FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    '<MsgType><![CDATA[text]]></MsgType>',
    `<Content><![CDATA[${escapeCdata(text)}]]></Content>`,
    '</xml>',
  ].join('');
}

function readXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1] ?? match?.[2] ?? '';
}

function escapeCdata(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
}
