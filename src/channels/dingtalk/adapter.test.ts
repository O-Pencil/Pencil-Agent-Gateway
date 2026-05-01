/**
 * DingTalk Channel Adapter Tests
 *
 * [WHO]  Test suite for DingTalk channel wrapper behavior
 * [FROM] DingTalk relay payload fixtures
 * [TO]  Vitest test runner
 * [HERE] Verifies text normalization and markdown formatting without Gateway internals
 */

import { describe, expect, it } from 'vitest';
import { extractDingTalkText, normalizeDingTalkMarkdown, normalizeDingTalkPayload } from './adapter.js';

describe('DingTalk channel adapter', () => {
  it('normalizes dingtalk-stream data payloads', () => {
    const message = normalizeDingTalkPayload({
      data: {
        messageId: 'msg-1',
        messageType: 'text',
        conversationId: 'cid-1',
        conversationType: '1',
        senderId: 'sender-1',
        text: { content: 'hello' },
        sessionWebhook: 'https://api.dingtalk.com/v1.0/robot/sessionMessages/send',
        createAt: 1710000000000,
      },
    }, 'default');

    expect(message).toMatchObject({
      id: 'msg-1',
      channel: 'dingtalk',
      accountId: 'default',
      senderId: 'sender-1',
      chatType: 'dm',
      chatId: 'cid-1',
      text: 'hello',
      receivedAt: 1710000000000,
    });
  });

  it('extracts rich text parts', () => {
    expect(extractDingTalkText({
      richTextContent: {
        richTextList: [{ text: 'hello' }, { content: 'world' }],
      },
    })).toBe('hello world');
  });

  it('normalizes markdown quirks', () => {
    expect(normalizeDingTalkMarkdown('Intro\n1. first\n  ```ts\ncode\n```')).toBe(
      'Intro\n\n1. first\n```ts\ncode\n```',
    );
  });
});
