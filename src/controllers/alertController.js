'use strict';

const alertModel = require('../models/alertModel');
const { NotFoundError } = require('../utils/errors');

async function list(req, res, next) {
  try {
    const status = req.query.status ? req.query.status.toUpperCase() : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const alerts = await alertModel.findAll({ status, limit });
    res.status(200).json({ data: alerts, meta: { count: alerts.length } });
  } catch (err) { next(err); }
}

async function acknowledge(req, res, next) {
  try {
    const alert = await alertModel.acknowledge(req.params.id, req.user.id);
    if (!alert) throw new NotFoundError('Open alert');
    res.status(200).json({ data: alert });
  } catch (err) { next(err); }
}

module.exports = { list, acknowledge };
