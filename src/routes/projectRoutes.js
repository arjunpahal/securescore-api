'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const controller = require('../controllers/projectController');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  validate,
  controller.list
);

router.get('/statistics', controller.statistics);

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Project id must be a valid UUID')],
  validate,
  controller.getById
);

router.get(
  '/:id/score',
  [param('id').isUUID().withMessage('Project id must be a valid UUID')],
  validate,
  controller.getScore
);

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name must be 2-120 characters'),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('repositoryUrl').isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('repositoryUrl must be a valid http(s) URL')
  ],
  validate,
  controller.create
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 120 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('repositoryUrl').optional().isURL({ protocols: ['http', 'https'], require_protocol: true })
  ],
  validate,
  controller.update
);

router.delete(
  '/:id',
  authorize('admin', 'lead'),
  [param('id').isUUID()],
  validate,
  controller.remove
);

module.exports = router;
