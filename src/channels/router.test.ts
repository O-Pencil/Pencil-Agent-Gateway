import { beforeEach, describe, expect, it } from 'vitest';
import { setConfig, type GatewayConfig } from '../config.js';
import { ForbiddenError } from '../util/errors.js';
import { buildChannelSessionId, resolveChannelMessage } from './router.js';
import type { NormalizedMessage } from './types.js';

const baseConfig: GatewayConfig = {
  gateway: {
    host: '0.0.0.0',
    port: 8080,
    logLevel: 'error',
    corsOrigins: '*',
    requestTimeoutMs: 120000,
  },
  apiKeys: [{ key: 'pk_test', allowedAgents: '*' }],
  dataDir: './data',
  agents: [],
  channels: {
    gateway: {
      baseUrl: 'http://127.0.0.1:8080',
      apiKey: 'pk_channel',
      defaultAgentModel: 'pencil/default',
    },
    allowlist: {
      senderIds: ['sender-1'],
    },
    routes: [
      {
        channel: 'feishu',
        accountId: 'default',
        chatId: 'chat-1',
        agentModel: 'pencil/writing',
      },
    ],
  },
};

const message: NormalizedMessage = {
  id: 'msg-1',
  channel: 'feishu',
  accountId: 'default',
  senderId: 'sender-1',
  chatType: 'group',
  chatId: 'chat-1',
  text: 'hello',
  receivedAt: 1,
};

describe('channel router', () => {
  beforeEach(() => {
    setConfig(baseConfig);
  });

  it('resolves the most specific route and derives a safe session id', () => {
    const resolution = resolveChannelMessage(message);

    expect(resolution.agentModel).toBe('pencil/writing');
    expect(resolution.apiKey).toBe('pk_channel');
    expect(resolution.sessionId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(resolution.sessionId).toBe(buildChannelSessionId(message));
  });

  it('falls back to defaultAgentModel when no route matches', () => {
    const resolution = resolveChannelMessage({ ...message, chatId: 'other-chat' });

    expect(resolution.agentModel).toBe('pencil/default');
  });

  it('rejects unallowed senders', () => {
    expect(() => resolveChannelMessage({ ...message, chatId: 'other-chat', senderId: 'stranger' })).toThrow(ForbiddenError);
  });
});
