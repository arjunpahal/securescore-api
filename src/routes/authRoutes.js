'use strict';

const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/authController');

const router = express.Router();

/**
 * Stricter rate limit on authentication endpoints to slow down
 * credential-stuffing and brute-force attempts.
 */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' } }
});

router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('password')
      .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
      .matches(/[0-9]/).withMessage('Password must contain a number'),
    body('role').optional().isIn(['developer', 'lead', 'admin']).withMessage('Invalid role')
  ],
  validate,
  controller.register
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  controller.login
);

router.get('/me', authenticate, controller.me);

module.exports = router;
