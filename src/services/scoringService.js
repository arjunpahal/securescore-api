'use strict';

const config = require('../config');
const { ValidationError } = require('../utils/errors');

const { weights, thresholds, stalenessPenaltyPerDay, maxStalenessPenalty } = config.scoring;

const VALID_SEVERITIES = Object.keys(weights);

/**
 * SecureScore Scoring Engine
 * --------------------------
 * Converts raw vulnerability findings into a single Security Health Score
 * between 0 and 100, plus a human-readable risk rating.
 *
 * Design rationale:
 *  - A weighted deduction model is used rather than a simple count so that
 *    one critical finding outweighs many low-severity findings.
 *  - A staleness penalty is applied for projects that have not been scanned
 *    recently, because an out-of-date scan provides false assurance.
 *  - The score is clamped to [0, 100] so downstream consumers (dashboards,
 *    alerting rules) can rely on a fixed range.
 *
 * This module is deliberately pure (no I/O, no database access) which makes
 * it fully unit-testable and is the primary target of the Test stage in the
 * CI/CD pipeline.
 */

/**
 * Validate a findings object before scoring.
 * @param {Object} findings - counts keyed by severity
 * @throws {ValidationError} when input is malformed
 */
function validateFindings(findings) {
  if (findings === null || typeof findings !== 'object' || Array.isArray(findings)) {
    throw new ValidationError('Findings must be an object keyed by severity');
  }

  for (const [severity, count] of Object.entries(findings)) {
    if (!VALID_SEVERITIES.includes(severity)) {
      throw new ValidationError(
        `Unknown severity "${severity}". Expected one of: ${VALID_SEVERITIES.join(', ')}`
      );
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new ValidationError(
        `Count for severity "${severity}" must be a non-negative integer`
      );
    }
  }
}

/**
 * Calculate the total weighted deduction from a set of findings.
 * @param {Object} findings - e.g. { critical: 1, high: 2, medium: 5, low: 3 }
 * @returns {number} total deduction points
 */
function calculateDeduction(findings) {
  validateFindings(findings);

  return Object.entries(findings).reduce((total, [severity, count]) => {
    return total + weights[severity] * count;
  }, 0);
}

/**
 * Calculate the staleness penalty based on days since the last scan.
 * @param {number} daysSinceLastScan
 * @returns {number} penalty points (capped)
 */
function calculateStalenessPenalty(daysSinceLastScan) {
  if (typeof daysSinceLastScan !== 'number' || Number.isNaN(daysSinceLastScan)) {
    throw new ValidationError('daysSinceLastScan must be a number');
  }
  if (daysSinceLastScan < 0) {
    throw new ValidationError('daysSinceLastScan cannot be negative');
  }

  const penalty = daysSinceLastScan * stalenessPenaltyPerDay;
  return Math.min(penalty, maxStalenessPenalty);
}

/**
 * Map a numeric score to a risk rating label.
 * @param {number} score - 0 to 100
 * @returns {'HEALTHY'|'MODERATE'|'AT_RISK'|'CRITICAL'}
 */
function getRating(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    throw new ValidationError('Score must be a number');
  }
  if (score >= thresholds.healthy) return 'HEALTHY';
  if (score >= thresholds.moderate) return 'MODERATE';
  if (score >= thresholds.atRisk) return 'AT_RISK';
  return 'CRITICAL';
}

/**
 * Determine whether a score should trigger an alert.
 * @param {number} score
 * @param {number} previousScore
 * @returns {{ shouldAlert: boolean, reason: string|null }}
 */
function evaluateAlertCondition(score, previousScore = null) {
  const rating = getRating(score);

  if (rating === 'CRITICAL') {
    return { shouldAlert: true, reason: 'SCORE_CRITICAL' };
  }

  if (previousScore !== null && typeof previousScore === 'number') {
    const drop = previousScore - score;
    if (drop >= 20) {
      return { shouldAlert: true, reason: 'SIGNIFICANT_SCORE_DROP' };
    }
    if (getRating(previousScore) === 'HEALTHY' && rating !== 'HEALTHY') {
      return { shouldAlert: true, reason: 'DROPPED_BELOW_HEALTHY' };
    }
  }

  return { shouldAlert: false, reason: null };
}

/**
 * Main entry point: calculate a complete Security Health Score result.
 *
 * @param {Object} params
 * @param {Object} params.findings - counts keyed by severity
 * @param {number} [params.daysSinceLastScan=0]
 * @param {number|null} [params.previousScore=null]
 * @returns {{
 *   score: number,
 *   rating: string,
 *   deduction: number,
 *   stalenessPenalty: number,
 *   totalFindings: number,
 *   breakdown: Object,
 *   alert: { shouldAlert: boolean, reason: string|null }
 * }}
 */
function calculateHealthScore({ findings = {}, daysSinceLastScan = 0, previousScore = null } = {}) {
  const deduction = calculateDeduction(findings);
  const stalenessPenalty = calculateStalenessPenalty(daysSinceLastScan);

  const rawScore = 100 - deduction - stalenessPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const totalFindings = Object.values(findings).reduce((sum, n) => sum + n, 0);

  const breakdown = VALID_SEVERITIES.reduce((acc, severity) => {
    const count = findings[severity] || 0;
    acc[severity] = {
      count,
      weight: weights[severity],
      deduction: count * weights[severity]
    };
    return acc;
  }, {});

  return {
    score,
    rating: getRating(score),
    deduction: Math.round(deduction * 100) / 100,
    stalenessPenalty: Math.round(stalenessPenalty * 100) / 100,
    totalFindings,
    breakdown,
    alert: evaluateAlertCondition(score, previousScore)
  };
}

module.exports = {
  calculateHealthScore,
  calculateDeduction,
  calculateStalenessPenalty,
  getRating,
  evaluateAlertCondition,
  validateFindings,
  VALID_SEVERITIES
};
