'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/scanController');
const { VALID_SEVERITIES } = require('../services/scoringService');

const router = express.Router();

/**
 * Validator for the findings payload. Rejects unknown severities and
 * negative counts before the request reaches the scoring engine.
 */
const findingsValidator = body('findings')
  .isObject().withMessage('findings must be an object')
  .custom((value) => {
    for (const [severity, count] of Object.entries(value)) {
      if (!VALID_SEVERITIES.includes(severity)) {
        throw new Error(`Unknown severity "${severity}"`);
      }
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Count for "${severity}" must be a non-negative integer`);
      }
    }
    return true;
  });

router.use(authenticate);

router.post(
  '/',
  [
    body('projectId').isUUID().withMessage('projectId must be a valid UUID'),
    findingsValidator
  ],
  validate,
  controller.runScan
);

router.post(
  '/preview',
  [
    findingsValidator,
    body('daysSinceLastScan').optional().isInt({ min: 0 }),
    body('previousScore').optional().isInt({ min: 0, max: 100 })
  ],
  validate,
  controller.preview
);

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  controller.getById
);

router.get(
  '/project/:projectId',
  [param('projectId').isUUID(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  controller.listByProject
);

module.exports = router;
