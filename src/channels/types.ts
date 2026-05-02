/**
 * Pencil Channel Gateway Types
 *
 * [WHO]  Channel wrapper runtime
 * [FROM] External message platforms such as WeChat and Feishu
 * [TO]  Gateway HTTP client and platform outbound adapters
 * [HERE] Minimal channel-facing contracts; no AgentRegistry, EngineAdapter, or nano-pencil imports
 */

export type ChannelId = 'dingtalk' | 'feishu' | 'wechat' | (string & {});

export type ChannelChatType = 'dm' | 'group' | 'channel' | 'thread';

export interface NormalizedMessage {
  id: string;
  channel: ChannelId;
  accountId: string;
  senderId: string;
  chatType: ChannelChatType;
  chatId: string;
  threadId?: string;
  text: string;
  receivedAt: number;
  raw?: unknown;
}

export interface OutboundMessage {
  channel: ChannelId;
  accountId: string;
  chatType: ChannelChatType;
  chatId: string;
  threadId?: string;
  text: string;
  replyToMessageId?: string;
  raw?: unknown;
}

export interface ChannelRoute {
  channel?: ChannelId;
  accountId?: string;
  chatType?: ChannelChatType;
  chatId?: string;
  senderId?: string;
  agentModel: `pencil/${string}`;
  apiKey?: string;
}

export interface ChannelAllowlist {
  allowAll?: boolean;
  senderIds?: string[];
  chatIds?: string[];
}

export interface ChannelGatewayConfig {
  baseUrl: string;
  apiKey: string;
  defaultAgentModel?: `pencil/${string}`;
  timeoutMs?: number;
}

export interface ChannelServerConfig {
  host?: string;
  port?: number;
}

export interface FeishuAccountConfig {
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
}

export interface WeChatAccountConfig {
  token?: string;
}

export interface DingTalkAccountConfig {
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
  requireMention?: boolean;
  freeResponseChatIds?: string[];
  mentionPatterns?: string[];
  /**
   * AI card template id (ends in `.schema`) created on DingTalk's card platform.
   * When set together with `clientId`+`clientSecret`+`robotCode`, DingTalk
   * webhook deliveries use the AI card streaming pipeline (typewriter effect)
   * instead of the legacy single-shot sessionWebhook markdown post.
   *
   * For quick local testing the docs publish a shared example template:
   *   `8aebdfb9-28f4-4a98-98f5-396c3dde41a0.schema`
   * Production deployments should create their own template under their own
   * app — the example template can be revoked or rate-limited at any time.
   */
  cardTemplateId?: string;
  /**
   * Robot code used for outbound card delivery. For Stream-mode robots this
   * equals the AppKey (clientId). Leave unset to fall back to clientId.
   */
  robotCode?: string;
  /**
   * Variable name inside the card template that holds the streaming markdown
   * body. Defaults to `content` to match DingTalk's published example
   * template; override only if your custom template uses a different key.
   */
  cardContentKey?: string;
  /**
   * Force streaming on/off independently of cardTemplateId presence. Useful
   * to fall back to sessionWebhook delivery for one account while keeping
   * the template configured for others. Defaults to true when cardTemplateId
   * + creds + robotCode are all present.
   */
  streamingEnabled?: boolean;
}

export interface ChannelAccountsConfig {
  dingtalk?: Record<string, DingTalkAccountConfig>;
  feishu?: Record<string, FeishuAccountConfig>;
  wechat?: Record<string, WeChatAccountConfig>;
  [channel: string]: Record<string, unknown> | undefined;
}

export interface ChannelsConfig {
  enabled?: boolean;
  server?: ChannelServerConfig;
  gateway?: Partial<ChannelGatewayConfig>;
  allowlist?: ChannelAllowlist;
  routes?: ChannelRoute[];
  accounts?: ChannelAccountsConfig;
}

export interface ChannelResolution {
  agentModel: `pencil/${string}`;
  apiKey: string;
  sessionId: string;
  route?: ChannelRoute;
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  deliver(message: OutboundMessage): Promise<void>;
}
