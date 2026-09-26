'use strict';

const client = require('prom-client');
const config = require('../config');

/**
 * Prometheus metrics registry.
 *
 * These metrics are scraped by Prometheus and visualised in Grafana as part
 * of the Monitoring and Alerting stage of the CI/CD pipeline. Custom
 * application metrics (not just default process metrics) are exposed so
 * that alert rules can be written against meaningful business signals —
 * for example, alerting when the average project health score drops.
 */
const register = new client.Registry();

register.setDefaultLabels({
  app: 'securescore-api',
  version: config.version,
  env: config.env
});

// Default Node.js process metrics: heap, event loop lag, GC, CPU.
client.collectDefaultMetrics({ register, prefix: 'securescore_' });

/** Total HTTP requests, partitioned by method, route and status. */
const httpRequestsTotal = new client.Counter({
  name: 'securescore_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

/** Request duration histogram — powers p95/p99 latency panels in Grafana. */
const httpRequestDuration = new client.Histogram({
  name: 'securescore_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

/** Count of scans executed, partitioned by resulting rating. */
const scansTotal = new client.Counter({
  name: 'securescore_scans_total',
  help: 'Total number of security scans executed',
  labelNames: ['rating'],
  registers: [register]
});

/** Current health score per project — the core business metric. */
const projectHealthScore = new client.Gauge({
  name: 'securescore_project_health_score',
  help: 'Current Security Health Score for a project (0-100)',
  labelNames: ['project_id', 'project_name'],
  registers: [register]
});

/** Number of open vulnerabilities by severity across all projects. */
const vulnerabilitiesOpen = new client.Gauge({
  name: 'securescore_vulnerabilities_open',
  help: 'Number of currently open vulnerabilities by severity',
  labelNames: ['severity'],
  registers: [register]
});

/** Alerts raised, partitioned by reason. */
const alertsTotal = new client.Counter({
  name: 'securescore_alerts_total',
  help: 'Total number of alerts raised by the scoring engine',
  labelNames: ['reason'],
  registers: [register]
});

/** Authentication attempts, partitioned by outcome. */
const authAttemptsTotal = new client.Counter({
  name: 'securescore_auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['outcome'],
  registers: [register]
});

/** Database connectivity indicator: 1 = up, 0 = down. */
const databaseUp = new client.Gauge({
  name: 'securescore_database_up',
  help: 'Database connectivity status (1 = reachable, 0 = unreachable)',
  registers: [register]
});

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  scansTotal,
  projectHealthScore,
  vulnerabilitiesOpen,
  alertsTotal,
  authAttemptsTotal,
  databaseUp
};
