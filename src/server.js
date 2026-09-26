'use strict';

const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./config/database');
const { databaseUp } = require('./utils/metrics');

const app = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(
    { port: config.port, env: config.env, version: config.version },
    `${config.appName} listening on port ${config.port}`
  );
});

/**
 * Periodically refresh the database-up gauge so Prometheus always has a
 * fresh value even when no request has hit /ready recently.
 */
const healthInterval = setInterval(async () => {
  const ok = await db.healthCheck();
  databaseUp.set(ok ? 1 : 0);
}, 15000);
healthInterval.unref();

/**
 * Graceful shutdown. Docker and Kubernetes send SIGTERM before killing a
 * container; draining connections here prevents dropped requests during
 * the Deploy and Release stages of the pipeline.
 */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received, draining connections');
  clearInterval(healthInterval);

  server.close(async () => {
    try {
      await db.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force exit if connections do not drain within 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

module.exports = server;
