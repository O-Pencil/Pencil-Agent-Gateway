/**
 * Pencil Agent Gateway Server
 *
 * [WHO]  Gateway server process
 * [FROM] CLI / Docker entrypoint
 * [TO]  Hono app
 * [HERE] Server bootstrap and lifecycle management
 */

import { createApp } from './app.js';
import { loadConfig, setConfig, isConfigReady } from './config.js';
import { logger, LogLevel } from './util/logger.js';
import { serve } from '@hono/node-server';
import { initRegistry } from './agent/registry.js';
import { initSessionStore } from './store/session.js';

async function main(): Promise<void> {
  try {
    // Load configuration
    const config = loadConfig();
    setConfig(config);

    // Override with environment variables
    if (process.env.PORT) {
      config.gateway.port = parseInt(process.env.PORT, 10);
    }
    if (process.env.HOST) {
      config.gateway.host = process.env.HOST;
    }
    if (process.env.LOG_LEVEL) {
      config.gateway.logLevel = process.env.LOG_LEVEL;
    }
    if (process.env.DATA_DIR) {
      config.dataDir = process.env.DATA_DIR;
    }

    // Set log level from config
    const logLevelStr = config.gateway.logLevel.toUpperCase();
    const logLevel = LogLevel[logLevelStr as keyof typeof LogLevel] ?? LogLevel.INFO;
    logger.setLevel(logLevel);

    logger.info('Starting Pencil Agent Gateway...', {
      port: config.gateway.port,
      host: config.gateway.host,
    });

    // Check if config is ready
    if (!isConfigReady()) {
      throw new Error('Configuration not ready');
    }

    // Initialize agent registry
    const registry = initRegistry(config.dataDir);

    // Initialize session store
    initSessionStore(config.dataDir);

    // Load agents from persistent storage
    await registry.load();

    // Load agents from config file
    await registry.loadFromConfig(config.agents);

    logger.info('Agents loaded', { count: registry.getAll().length });

    // Refuse to start with zero API keys (issue 0010): a server in this state
    // returns 401 to every request, with no signal to the operator that the
    // cause is a missing/malformed config rather than truly-revoked keys.
    if (config.apiKeys.length === 0 && process.env.GATEWAY_ALLOW_NO_AUTH !== '1') {
      throw new Error(
        'Refusing to start: configuration loaded with zero API keys. ' +
          'Either fix GATEWAY_CONFIG / config/default.json to define apiKeys, ' +
          'set the API_KEY env var, or — if you really mean it — set ' +
          'GATEWAY_ALLOW_NO_AUTH=1 to bypass this check.',
      );
    }

    // Create Hono app
    const app = createApp();

    // Start server
    const server = serve({
      fetch: app.fetch,
      port: config.gateway.port,
      hostname: config.gateway.host,
    });

    logger.info(`Server listening on http://${config.gateway.host}:${config.gateway.port}`);

    // Graceful shutdown (issue 0008): close listener, then dispose every
    // agent engine within a bounded timeout, then exit. We never let a stuck
    // engine block container termination forever — the orchestrator's TERM→KILL
    // window is short and stalling here just turns into a SIGKILL anyway.
    const shutdownTimeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '10000', 10);
    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal}, shutting down gracefully...`, { shutdownTimeoutMs });
      server.close();
      try {
        await Promise.race([
          registry.disposeAll(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('engine disposal exceeded shutdownTimeoutMs')), shutdownTimeoutMs),
          ),
        ]);
        logger.info('All engines disposed');
      } catch (err) {
        logger.warn('Engine disposal incomplete', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      logger.info('Server shut down complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start server', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Failed to start server', { error: err });
  process.exit(1);
});
