'use strict';

const db = require('../config/database');
const config = require('../config');
const { register, databaseUp } = require('../utils/metrics');

const startedAt = Date.now();

/**
 * Liveness probe. Returns 200 whenever the process is running.
 * Used by Docker HEALTHCHECK and Kubernetes liveness probes.
 */
async function health(req, res) {
  res.status(200).json({
    status: 'ok',
    service: config.appName,
    version: config.version,
    env: config.env,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString()
  });
}

/**
 * Readiness probe. Returns 503 when a downstream dependency is
 * unavailable, so the deploy stage can gate traffic correctly.
 */
async function ready(req, res) {
  const dbOk = await db.healthCheck();
  databaseUp.set(dbOk ? 1 : 0);

  const status = dbOk ? 200 : 503;
  res.status(status).json({
    status: dbOk ? 'ready' : 'not_ready',
    checks: { database: dbOk ? 'up' : 'down' },
    timestamp: new Date().toISOString()
  });
}

/**
 * Prometheus scrape endpoint.
 */
async function metrics(req, res, next) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) { next(err); }
}

module.exports = { health, ready, metrics };
