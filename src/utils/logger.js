'use strict';

const pino = require('pino');
const config = require('../config');

/**
 * Structured JSON logger.
 * JSON output is required so that log aggregation tools (and the
 * monitoring stage of the CI/CD pipeline) can parse log lines reliably.
 */
const logger = pino({
  level: config.logging.level,
  base: {
    service: 'securescore-api',
    version: config.version,
    env: config.env
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'passwordHash'],
    censor: '[REDACTED]'
  }
});

module.exports = logger;
