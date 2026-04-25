/**
 * Pencil Agent Gateway App
 *
 * [WHO]  Gateway server
 * [FROM] HTTP clients
 * [TO]  Routes, engine adapters, stores
 * [HERE] Main Hono application setup and middleware
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getConfig } from './config.js';
import { logger } from './util/logger.js';
import { GatewayError, NotFoundError } from './util/errors.js';
import { isConfigReady } from './config.js';
import { authMiddleware } from './auth/middleware.js';
import { getRegistry } from './agent/registry.js';
import { handleChatCompletion } from './routes/chat.js';

export type ApiKeyConfig = {
  key: string;
  label?: string;
  allowedAgents: '*' | string[];
};

export type AppEnv = {
  Bindings: {};
  Variables: {
    requestId?: string;
    apiKey?: ApiKeyConfig;
  };
};

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // CORS middleware (must be before auth for OPTIONS preflight)
  app.use('*', async (c, next) => {
    let origins: string[] = ['*'];
    try {
      const config = getConfig();
      const corsOrigins = config.gateway.corsOrigins;
      if (corsOrigins && corsOrigins !== '*') {
        origins = corsOrigins.split(',').map(s => s.trim()).filter(Boolean);
      }
    } catch {
      // Config not loaded yet, default to permissive
      origins = ['*'];
    }

    const corsHandler = cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Asgard-User', 'X-Asgard-Agent', 'X-Pencil-Session'],
      exposeHeaders: ['Content-Type'],
      maxAge: 86400,
    });
    return corsHandler(c, next);
  });

  // Request ID middleware
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    c.set('requestId', requestId);
    await next();
  });

  // Health check endpoints (no auth required)
  app.get('/healthz', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/readyz', (c) => {
    const ready = isConfigReady();
    return c.json({
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      config: ready ? 'loaded' : 'not_loaded',
    });
  });

  // API v1 routes (with authentication)
  const v1 = new Hono<AppEnv>();

  // Apply auth middleware to all v1 routes
  v1.use('*', authMiddleware);

  // Models endpoint (OpenAI-compatible)
  v1.get('/models', (c) => {
    const registry = getRegistry();
    return c.json({
      object: 'list',
      data: registry.getModels(),
    });
  });

  // Chat completions endpoint (OpenAI-compatible)
  v1.post('/chat/completions', handleChatCompletion);

  // Agents endpoint - list all agents
  v1.get('/agents', (c) => {
    const registry = getRegistry();
    return c.json({
      data: registry.getAll().map((agent) => agent.toResponse()),
    });
  });

  // Agents endpoint - create or update agent
  v1.post('/agents', async (c) => {
    const body = await c.req.json();

    if (!body.id) {
      throw new GatewayError('Agent config must include "id"', 400, 'invalid_request');
    }

    const registry = getRegistry();
    const instance = registry.register(body);

    logger.info('Agent created/updated', {
      requestId: c.get('requestId'),
      id: instance.id,
      modelId: instance.modelId,
    });

    return c.json({
      id: instance.id,
      modelId: instance.modelId,
      status: 'ready',
    });
  });

  // Agents endpoint - delete agent
  v1.delete('/agents/:id', (c) => {
    const id = c.req.param('id');
    const registry = getRegistry();

    if (!registry.has(id)) {
      throw new NotFoundError(`Agent instance '${id}' not found`);
    }

    registry.delete(id);

    logger.info('Agent deleted', {
      requestId: c.get('requestId'),
      id,
    });

    return c.json({
      id,
      deleted: true,
    });
  });

  // Mount v1 routes
  app.route('/v1', v1);

  // Error handler
  app.onError((err, c) => {
    logger.error('Request error', {
      requestId: c.get('requestId'),
      path: c.req.path,
      error: err.message,
    });

    if (err instanceof GatewayError) {
      return c.json<unknown>(
        {
          error: {
            type: 'invalid_request_error',
            code: err.code,
            message: err.message,
          },
        },
        err.statusCode as 400 | 401 | 403 | 404 | 408 | 409 | 422 | 500
      );
    }

    // Unknown errors
    return c.json<unknown>(
      {
        error: {
          type: 'internal_server_error',
          code: 'internal_error',
          message: 'An unexpected error occurred',
        },
      },
      500
    );
  });

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: {
          type: 'invalid_request_error',
          code: 'not_found',
          message: `Path ${c.req.path} not found`,
        },
      },
      404
    );
  });

  logger.info('Pencil Agent Gateway app created');
  return app;
}
