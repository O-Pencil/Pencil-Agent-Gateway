import { describe, expect, it } from 'vitest';
import { normalizeInboundTextForDedup, shouldProcessDingTalkInbound } from './dedup.js';
import type { NormalizedMessage } from '../types.js';

function msg(text: string): NormalizedMessage {
  return {
    id: 'mid-1',
    channel: 'dingtalk',
    accountId: 'default',
    senderId: 'ou_x',
    chatType: 'group',
    chatId: 'cid1',
    text,
    receivedAt: Date.now(),
    raw: {},
  };
}

describe('shouldProcessDingTalkInbound', () => {
  it('accepts first sighting', () => {
    expect(shouldProcessDingTalkInbound('default', msg('hello'))).toBe(true);
  });

  it('rejects identical fingerprint within window', () => {
    expect(shouldProcessDingTalkInbound('default', msg('dup'))).toBe(true);
    expect(shouldProcessDingTalkInbound('default', msg('dup'))).toBe(false);
  });

  it('allows same text after different sender isolation via chatId', () => {
    const m = msg('x');
    m.chatId = 'other';
    expect(shouldProcessDingTalkInbound('default', m)).toBe(true);
  });

  it('treats whitespace variants as the same fingerprint', () => {
    expect(shouldProcessDingTalkInbound('default', msg('a  b'))).toBe(true);
    expect(shouldProcessDingTalkInbound('default', msg('a\n\nb'))).toBe(false);
  });

  it('suppresses duplicate delivery when platform messageId repeats', () => {
    const raw = { messageId: 'dt-stable-msg-999' };
    const first: NormalizedMessage = { ...msg('hello'), raw };
    const redelivery: NormalizedMessage = { ...msg('hello'), raw };
    expect(shouldProcessDingTalkInbound('default', first)).toBe(true);
    expect(shouldProcessDingTalkInbound('default', redelivery)).toBe(false);
  });
});

describe('normalizeInboundTextForDedup', () => {
  it('collapses internal whitespace', () => {
    expect(normalizeInboundTextForDedup('a \n\t b')).toBe('a b');
  });
});
