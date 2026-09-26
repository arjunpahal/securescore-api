'use strict';

require('dotenv').config();

/**
 * Centralised application configuration.
 * All environment-specific values are read here so the rest of the
 * codebase never touches process.env directly. This makes the app
 * testable and satisfies 12-factor configuration principles.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appName: 'SecureScore API',
  version: process.env.APP_VERSION || '1.0.0',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'securescore',
    user: process.env.DB_USER || 'securescore',
    password: process.env.DB_PASSWORD || 'securescore_dev_password',
    poolMax: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMs: parseInt(process.env.DB_CONN_TIMEOUT, 10) || 5000
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev_only_secret_change_in_production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 10
  },

  scoring: {
    // Severity weights used by the Security Health Score algorithm.
    // Tuned so that a single critical finding has materially more impact
    // than several low-severity findings.
    weights: {
      critical: 25,
      high: 12,
      medium: 5,
      low: 1
    },
    // Score thresholds mapping a numeric score to a human-readable rating.
    thresholds: {
      healthy: 80,
      moderate: 60,
      atRisk: 40
    },
    // Penalty applied per day since the last successful scan, capped.
    stalenessPenaltyPerDay: 0.5,
    maxStalenessPenalty: 15
  },

  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
  }
};

module.exports = config;
