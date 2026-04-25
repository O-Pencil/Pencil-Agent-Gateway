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
    registry.loadFromConfig(config.agents);

    logger.info('Agents loaded', { count: registry.getAll().length });

    // Create Hono app
    const app = createApp();

    // Start server
    const server = serve({
      fetch: app.fetch,
      port: config.gateway.port,
      hostname: config.gateway.host,
    });

    logger.info(`Server listening on http://${config.gateway.host}:${config.gateway.port}`);

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      server.close();
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
