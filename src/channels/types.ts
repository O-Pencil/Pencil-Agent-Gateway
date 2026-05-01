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
