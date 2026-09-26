'use strict';

const scanService = require('../services/scanService');
const scanModel = require('../models/scanModel');
const scoringService = require('../services/scoringService');
const { NotFoundError } = require('../utils/errors');

async function runScan(req, res, next) {
  try {
    const { projectId, findings } = req.body;
    const result = await scanService.runScan({
      projectId, findings, triggeredBy: req.user.id
    });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const scan = await scanModel.findById(req.params.id);
    if (!scan) throw new NotFoundError('Scan');
    res.status(200).json({ data: scan });
  } catch (err) { next(err); }
}

async function listByProject(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const scans = await scanModel.findByProject(req.params.projectId, { limit });
    res.status(200).json({ data: scans, meta: { count: scans.length } });
  } catch (err) { next(err); }
}

/**
 * Stateless score preview. Allows a client to see what a given set of
 * findings would score without persisting a scan. Useful for the
 * dashboard's "what if" simulator and trivially unit-testable.
 */
async function preview(req, res, next) {
  try {
    const { findings, daysSinceLastScan, previousScore } = req.body;
    const result = scoringService.calculateHealthScore({
      findings,
      daysSinceLastScan: daysSinceLastScan || 0,
      previousScore: previousScore ?? null
    });
    res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

module.exports = { runScan, getById, listByProject, preview };
