'use strict';

const logger = require('../utils/logger');
const config = require('../config');
const { AppError } = require('../utils/errors');

/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`
    }
  });
}

/**
 * Global error handler.
 * Operational errors (AppError subclasses) return their own status code
 * and message. Unexpected errors are logged in full but return a generic
 * message so internal details are never leaked to clients — this is a
 * deliberate security control verified during the Security stage.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    logger.warn(
      { code: err.code, status: err.statusCode, path: req.path },
      err.message
    );
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    });
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(config.env === 'development' ? { stack: err.stack } : {})
    }
  });
}

module.exports = { notFoundHandler, errorHandler };
