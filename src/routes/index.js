'use strict';

const express = require('express');
const authRoutes = require('./authRoutes');
const projectRoutes = require('./projectRoutes');
const scanRoutes = require('./scanRoutes');
const alertRoutes = require('./alertRoutes');
const healthController = require('../controllers/healthController');

const router = express.Router();

// Operational endpoints — intentionally unauthenticated so that
// orchestrators and Prometheus can reach them.
router.get('/health', healthController.health);
router.get('/ready', healthController.ready);
router.get('/metrics', healthController.metrics);

// API v1
router.use('/api/v1/auth', authRoutes);
router.use('/api/v1/projects', projectRoutes);
router.use('/api/v1/scans', scanRoutes);
router.use('/api/v1/alerts', alertRoutes);

// Service discovery root
router.get('/', (req, res) => {
  res.status(200).json({
    service: 'SecureScore API',
    version: process.env.APP_VERSION || '1.0.0',
    documentation: '/api/v1',
    endpoints: {
      health: '/health',
      readiness: '/ready',
      metrics: '/metrics',
      auth: '/api/v1/auth',
      projects: '/api/v1/projects',
      scans: '/api/v1/scans',
      alerts: '/api/v1/alerts'
    }
  });
});

module.exports = router;
