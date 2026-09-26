'use strict';

const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/errors');

/**
 * Collects express-validator results and converts them into a
 * consistent ValidationError. Placed after the validation chain
 * on each route.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((e) => ({
    field: e.path || e.param,
    message: e.msg
  }));

  return next(new ValidationError('Request validation failed', details));
}

module.exports = validate;
