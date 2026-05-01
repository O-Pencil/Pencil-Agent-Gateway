/**
 * Pencil Channel Router
 *
 * [WHO]  Channel wrapper runtime
 * [FROM] NormalizedMessage plus optional channels config
 * [TO]  Gateway HTTP client request metadata
 * [HERE] Channel authorization, route selection, and safe session id derivation
 */

import { createHash } from 'node:crypto';
import { getConfig } from '../config.js';
import { ForbiddenError, InvalidRequestError, NotFoundError } from '../util/errors.js';
import type {
  ChannelAllowlist,
  ChannelGatewayConfig,
  ChannelResolution,
  ChannelRoute,
  ChannelsConfig,
  NormalizedMessage,
} from './types.js';

const DEFAULT_CHANNEL_PORT = 8090;

export function getChannelsConfig(): ChannelsConfig {
  return getConfig().channels ?? {};
}

export function getChannelServerPort(): number {
  const configured = getChannelsConfig().server?.port;
  if (configured && configured > 0) return configured;
  return parseInt(process.env.CHANNEL_PORT || `${DEFAULT_CHANNEL_PORT}`, 10);
}

export function getChannelServerHost(): string {
  return getChannelsConfig().server?.host || process.env.CHANNEL_HOST || '0.0.0.0';
}

export function resolveGatewayConfig(route?: ChannelRoute): ChannelGatewayConfig {
  const config = getConfig();
  const channels = getChannelsConfig();
  const gateway = channels.gateway ?? {};
  const apiKey =
    route?.apiKey ||
    gateway.apiKey ||
    process.env.CHANNEL_GATEWAY_API_KEY ||
    process.env.API_KEY ||
    config.apiKeys[0]?.key;

  if (!apiKey) {
    throw new InvalidRequestError(
      'Channel gateway apiKey is missing. Set channels.gateway.apiKey, CHANNEL_GATEWAY_API_KEY, or API_KEY.',
    );
  }

  return {
    baseUrl:
      gateway.baseUrl ||
      process.env.CHANNEL_GATEWAY_BASE_URL ||
      `http://127.0.0.1:${config.gateway.port}`,
    apiKey,
    defaultAgentModel: gateway.defaultAgentModel,
    timeoutMs: gateway.timeoutMs ?? config.gateway.requestTimeoutMs,
  };
}

export function resolveChannelMessage(message: NormalizedMessage): ChannelResolution {
  const channels = getChannelsConfig();
  const route = findRoute(message, channels.routes ?? []);
  assertAllowed(message, channels.allowlist, route);

  const gateway = resolveGatewayConfig(route);
  const agentModel = route?.agentModel || gateway.defaultAgentModel;

  if (!agentModel) {
    throw new NotFoundError(
      `No channel route matched ${message.channel}/${message.accountId}/${message.chatId}, and no defaultAgentModel is configured`,
    );
  }

  return {
    agentModel,
    apiKey: route?.apiKey || gateway.apiKey,
    sessionId: buildChannelSessionId(message),
    route,
  };
}

export function findRoute(message: NormalizedMessage, routes: ChannelRoute[]): ChannelRoute | undefined {
  const matches = routes
    .filter((route) => routeMatches(route, message))
    .map((route) => ({ route, score: routeSpecificity(route) }))
    .sort((a, b) => b.score - a.score);

  return matches[0]?.route;
}

export function buildChannelSessionId(message: NormalizedMessage): string {
  const stableParts = [
    message.channel,
    message.accountId,
    message.chatType,
    message.chatId,
    message.threadId ?? 'main',
  ];
  const digest = createHash('sha256').update(stableParts.join('\n')).digest('hex').slice(0, 24);
  return `channel_${message.channel}_${message.accountId}_${message.chatType}_${digest}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function assertAllowed(
  message: NormalizedMessage,
  allowlist: ChannelAllowlist | undefined,
  route: ChannelRoute | undefined,
): void {
  if (allowlist?.allowAll) return;
  if (allowlist?.senderIds?.includes(message.senderId)) return;
  if (allowlist?.chatIds?.includes(message.chatId)) return;

  // Exact sender/chat routes are explicit host configuration and are safe to
  // treat as allowlist entries for first-party channel bindings.
  if (route?.senderId && route.senderId === message.senderId) return;
  if (route?.chatId && route.chatId === message.chatId) return;

  throw new ForbiddenError(
    `Channel sender '${message.senderId}' in chat '${message.chatId}' is not allowed`,
  );
}

function routeMatches(route: ChannelRoute, message: NormalizedMessage): boolean {
  return (
    fieldMatches(route.channel, message.channel) &&
    fieldMatches(route.accountId, message.accountId) &&
    fieldMatches(route.chatType, message.chatType) &&
    fieldMatches(route.chatId, message.chatId) &&
    fieldMatches(route.senderId, message.senderId)
  );
}

function fieldMatches<T extends string>(expected: T | undefined, actual: T): boolean {
  return expected === undefined || expected === actual;
}

function routeSpecificity(route: ChannelRoute): number {
  return [
    route.channel,
    route.accountId,
    route.chatType,
    route.chatId,
    route.senderId,
  ].filter(Boolean).length;
}
