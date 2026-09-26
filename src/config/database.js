'use strict';

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * PostgreSQL connection pool.
 * A single shared pool is used across the application; pg handles
 * connection reuse internally. The pool is exported alongside a
 * thin query helper that adds timing instrumentation, which feeds
 * the Prometheus metrics used by the Monitoring stage.
 */
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: config.database.poolMax,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  connectionTimeoutMillis: config.database.connectionTimeoutMs
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

/**
 * Execute a parameterised query.
 * Always use parameter placeholders ($1, $2 ...) rather than string
 * interpolation — this is the primary defence against SQL injection
 * and is verified by the Security stage of the pipeline.
 *
 * @param {string} text - SQL with $n placeholders
 * @param {Array} params - bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ duration, rows: result.rowCount }, 'Executed query');
    return result;
  } catch (err) {
    logger.error({ err, query: text }, 'Database query failed');
    throw err;
  }
}

/**
 * Run a set of statements inside a transaction.
 * @param {Function} callback - receives a client, must return a promise
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lightweight connectivity check used by the /health endpoint.
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const result = await pool.query('SELECT 1 AS ok');
    return result.rows[0].ok === 1;
  } catch (err) {
    logger.warn({ err }, 'Database health check failed');
    return false;
  }
}

async function close() {
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = { pool, query, transaction, healthCheck, close };
