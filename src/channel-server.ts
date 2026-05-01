/**
 * Pencil Channel Wrapper Server
 *
 * [WHO]  Channel wrapper process
 * [FROM] CLI / Docker entrypoint for message platform webhooks
 * [TO]  Channel HTTP app
 * [HERE] Optional channel server bootstrap; keeps platform webhooks separate from the main Gateway API server
 */

import { serve } from '@hono/node-server';
import { createChannelApp } from './channels/app.js';
import { getChannelServerHost, getChannelServerPort } from './channels/router.js';
import { loadConfig, setConfig } from './config.js';
import { logger, LogLevel } from './util/logger.js';

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    setConfig(config);

    const logLevelStr = config.gateway.logLevel.toUpperCase();
    const logLevel = LogLevel[logLevelStr as keyof typeof LogLevel] ?? LogLevel.INFO;
    logger.setLevel(logLevel);

    const host = getChannelServerHost();
    const port = getChannelServerPort();
    const app = createChannelApp();
    const server = serve({
      fetch: app.fetch,
      port,
      hostname: host,
    });

    logger.info(`Pencil channel wrapper listening on http://${host}:${port}`);

    const shutdown = (signal: string): void => {
      logger.info(`Received ${signal}, shutting down channel wrapper...`);
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start channel wrapper', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Failed to start channel wrapper', { error: err });
  process.exit(1);
});
