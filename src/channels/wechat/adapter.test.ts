import { describe, expect, it } from 'vitest';
import { setConfig, type GatewayConfig } from '../../config.js';
import {
  normalizeWeChatText,
  parseWeChatTextXml,
  renderWeChatTextReply,
  verifyWeChatSignature,
} from './adapter.js';

const config: GatewayConfig = {
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
    accounts: {
      wechat: {
        default: { token: 'token' },
      },
    },
  },
};

const xml = [
  '<xml>',
  '<ToUserName><![CDATA[gh_account]]></ToUserName>',
  '<FromUserName><![CDATA[user_openid]]></FromUserName>',
  '<MsgType><![CDATA[text]]></MsgType>',
  '<Content><![CDATA[hello]]></Content>',
  '<MsgId>123</MsgId>',
  '</xml>',
].join('');

describe('wechat adapter', () => {
  it('parses and normalizes text XML', () => {
    const parsed = parseWeChatTextXml(xml);
    const normalized = normalizeWeChatText(parsed, 'default', xml);

    expect(normalized.senderId).toBe('user_openid');
    expect(normalized.chatId).toBe('user_openid');
    expect(normalized.text).toBe('hello');
  });

  it('renders synchronous text reply XML', () => {
    const parsed = parseWeChatTextXml(xml);
    const reply = renderWeChatTextReply(parsed, 'hi there');

    expect(reply).toContain('<ToUserName><![CDATA[user_openid]]></ToUserName>');
    expect(reply).toContain('<FromUserName><![CDATA[gh_account]]></FromUserName>');
    expect(reply).toContain('<Content><![CDATA[hi there]]></Content>');
  });

  it('validates official account signatures', () => {
    setConfig(config);

    verifyWeChatSignature('default', {
      signature: '6d7149e287208afb17c14861c125053fd80c0f86',
      timestamp: '1',
      nonce: '2',
    });
  });
});
