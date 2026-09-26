'use strict';

const scanModel = require('../models/scanModel');
const projectModel = require('../models/projectModel');
const alertModel = require('../models/alertModel');
const scoringService = require('./scoringService');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
const { scansTotal, projectHealthScore, alertsTotal } = require('../utils/metrics');

/**
 * Human-readable messages for each alert reason produced by the
 * scoring engine. Keeping these centralised means the alerting
 * vocabulary stays consistent across the API and the dashboard.
 */
const ALERT_MESSAGES = {
  SCORE_CRITICAL: 'Project health score has fallen into the CRITICAL band',
  SIGNIFICANT_SCORE_DROP: 'Project health score dropped by 20 points or more since the previous scan',
  DROPPED_BELOW_HEALTHY: 'Project is no longer rated HEALTHY'
};

/**
 * Calculate the number of whole days between a timestamp and now.
 */
function daysSince(timestamp) {
  if (!timestamp) return 0;
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Execute a scan for a project: score the supplied findings, persist the
 * scan, update the project's current score, and raise an alert if the
 * scoring engine says one is warranted.
 */
async function runScan({ projectId, findings, triggeredBy }) {
  const project = await projectModel.findById(projectId);
  if (!project) throw new NotFoundError('Project');

  const previousScore = await scanModel.getLatestScore(projectId);
  const staleness = daysSince(project.last_scanned_at);

  const result = scoringService.calculateHealthScore({
    findings,
    daysSinceLastScan: staleness,
    previousScore
  });

  const scan = await scanModel.create({
    projectId,
    findings,
    score: result.score,
    rating: result.rating,
    deduction: result.deduction,
    stalenessPenalty: result.stalenessPenalty,
    triggeredBy
  });

  await projectModel.updateScore(projectId, {
    score: result.score,
    rating: result.rating
  });

  scansTotal.inc({ rating: result.rating });
  projectHealthScore.set(
    { project_id: projectId, project_name: project.name },
    result.score
  );

  let alert = null;
  if (result.alert.shouldAlert) {
    alert = await alertModel.create({
      projectId,
      scanId: scan.id,
      reason: result.alert.reason,
      severity: result.rating === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      message: ALERT_MESSAGES[result.alert.reason] || 'Security threshold breached'
    });
    alertsTotal.inc({ reason: result.alert.reason });
    logger.warn(
      { projectId, score: result.score, reason: result.alert.reason },
      'Security alert raised'
    );
  }

  return { scan: { ...scan, ...result }, alert };
}

module.exports = { runScan, daysSince, ALERT_MESSAGES };
