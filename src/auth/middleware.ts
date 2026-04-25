/**
 * Pencil Agent Gateway Authentication Middleware
 *
 * [WHO]  Gateway server
 * [FROM] HTTP clients (PencilAgent, OpenAI SDK, Asgard)
 * [TO]  Route handlers
 * [HERE] API Key authentication and agent access control
 */

import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError, ForbiddenError } from '../util/errors.js';
import { getConfig } from '../config.js';
import { logger } from '../util/logger.js';

/**
 * Extract API key from Authorization header
 */
export function extractApiKey(authHeader: string | null | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  // Support "Bearer <key>" format
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Get API key config from configuration
 */
export function getApiKeyConfig(apiKey: string) {
  const config = getConfig();

  for (const keyConfig of config.apiKeys) {
    if (keyConfig.key === apiKey) {
      return keyConfig;
    }
  }

  return null;
}

/**
 * Check if API key has access to a specific agent
 */
export function hasAgentAccess(keyConfig: { allowedAgents: '*' | string[] }, agentId: string): boolean {
  if (keyConfig.allowedAgents === '*') {
    return true;
  }
  return keyConfig.allowedAgents.includes(agentId);
}

/**
 * Authentication middleware
 * Verifies API key and adds key config to context
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('authorization');
  const apiKey = extractApiKey(authHeader);

  if (!apiKey) {
    logger.warn('Missing API key', {
      requestId: c.get('requestId'),
      path: c.req.path,
    });
    throw new UnauthorizedError('Missing or invalid API key');
  }

  const keyConfig = getApiKeyConfig(apiKey);

  if (!keyConfig) {
    logger.warn('Invalid API key', {
      requestId: c.get('requestId'),
      path: c.req.path,
      apiKey: apiKey.substring(0, 4) + '...',
    });
    throw new UnauthorizedError('Invalid API key');
  }

  // Log internal headers from Asgard (for audit, not auth)
  const asgardUser = c.req.header('x-asgard-user');
  const asgardAgent = c.req.header('x-asgard-agent');

  if (asgardUser || asgardAgent) {
    logger.debug('Asgard internal request', {
      requestId: c.get('requestId'),
      asgardUser,
      asgardAgent,
      keyConfig: keyConfig.label || keyConfig.key.substring(0, 4) + '...',
    });
  }

  // Add key config to context
  c.set('apiKey', keyConfig);

  await next();
};

/**
 * Agent access middleware
 * Must be used after authMiddleware
 * Checks if the API key has access to the specified agent
 */
export const agentAccessMiddleware = (agentIdParam: string = 'model'): MiddlewareHandler => {
  return async (c, next) => {
    const keyConfig = c.get('apiKey');

    if (!keyConfig) {
      throw new UnauthorizedError('Not authenticated');
    }

    // Get agent ID from query param or request body
    const agentId = c.req.param(agentIdParam) || c.req.query(agentIdParam);

    if (agentId) {
      // Handle both "agent-id" and "pencil/agent-id" formats
      const cleanAgentId = agentId.startsWith('pencil/')
        ? agentId.replace('pencil/', '')
        : agentId;

      if (!hasAgentAccess(keyConfig, cleanAgentId)) {
        logger.warn('API key does not have access to agent', {
          requestId: c.get('requestId'),
          agentId: cleanAgentId,
          keyConfig: keyConfig.label || keyConfig.key.substring(0, 4) + '...',
        });
        throw new ForbiddenError(`API key does not have access to agent '${cleanAgentId}'`);
      }
    }

    await next();
  };
};
