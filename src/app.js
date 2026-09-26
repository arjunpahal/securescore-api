'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const metricsMiddleware = require('./middleware/metricsMiddleware');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

/**
 * Express application factory.
 * Exported separately from server.js so that integration tests can
 * mount the app with supertest without binding a real port.
 */
function createApp() {
  const app = express();

  // Trust the first proxy hop so rate limiting and logging see real client IPs
  app.set('trust proxy', 1);

  // --- Security middleware -------------------------------------------------
  // helmet sets a suite of hardening headers (CSP, HSTS, X-Frame-Options,
  // X-Content-Type-Options and others). This is a deliberate control that
  // the Security stage of the pipeline verifies.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600
  }));

  // Global rate limit — a blunt but effective DoS mitigation.
  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => ['/health', '/ready', '/metrics'].includes(req.path),
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }
  }));

  // --- Body parsing --------------------------------------------------------
  // An explicit size limit prevents oversized-payload denial of service.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // --- Performance ---------------------------------------------------------
  app.use(compression());

  // --- Observability -------------------------------------------------------
  if (config.env !== 'test') {
    app.use(pinoHttp({
      logger,
      autoLogging: { ignore: (req) => ['/health', '/metrics'].includes(req.url) }
    }));
  }
  app.use(metricsMiddleware);

  // --- Routes --------------------------------------------------------------
  app.use(routes);

  // --- Error handling (must be registered last) ----------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
