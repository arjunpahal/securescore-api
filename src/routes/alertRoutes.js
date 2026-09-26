'use strict';

const express = require('express');
const { param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/alertController');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  [
    query('status').optional().isIn(['OPEN', 'ACKNOWLEDGED', 'open', 'acknowledged']),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  validate,
  controller.list
);

router.post(
  '/:id/acknowledge',
  [param('id').isUUID()],
  validate,
  controller.acknowledge
);

module.exports = router;
