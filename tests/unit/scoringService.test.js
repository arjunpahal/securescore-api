'use strict';

const scoring = require('../../src/services/scoringService');
const { ValidationError } = require('../../src/utils/errors');

/**
 * Unit tests for the Security Health Score engine.
 * This is the core business logic of SecureScore, so it carries the
 * densest test coverage in the project. All tests are pure — no database,
 * no network — which keeps the Test stage of the pipeline fast.
 */
describe('scoringService', () => {

  describe('calculateDeduction', () => {
    it('returns zero for an empty findings object', () => {
      expect(scoring.calculateDeduction({})).toBe(0);
    });

    it('applies the correct weight for a single critical finding', () => {
      expect(scoring.calculateDeduction({ critical: 1 })).toBe(25);
    });

    it('applies the correct weight for a single high finding', () => {
      expect(scoring.calculateDeduction({ high: 1 })).toBe(12);
    });

    it('applies the correct weight for a single medium finding', () => {
      expect(scoring.calculateDeduction({ medium: 1 })).toBe(5);
    });

    it('applies the correct weight for a single low finding', () => {
      expect(scoring.calculateDeduction({ low: 1 })).toBe(1);
    });

    it('sums weighted deductions across multiple severities', () => {
      // 1*25 + 2*12 + 3*5 + 4*1 = 25 + 24 + 15 + 4 = 68
      expect(scoring.calculateDeduction({ critical: 1, high: 2, medium: 3, low: 4 })).toBe(68);
    });

    it('weights one critical above five lows combined', () => {
      const critical = scoring.calculateDeduction({ critical: 1 });
      const lows = scoring.calculateDeduction({ low: 5 });
      expect(critical).toBeGreaterThan(lows);
    });

    it('rejects an unknown severity key', () => {
      expect(() => scoring.calculateDeduction({ catastrophic: 1 })).toThrow(ValidationError);
    });

    it('rejects a negative count', () => {
      expect(() => scoring.calculateDeduction({ high: -1 })).toThrow(ValidationError);
    });

    it('rejects a non-integer count', () => {
      expect(() => scoring.calculateDeduction({ high: 1.5 })).toThrow(ValidationError);
    });

    it('rejects an array instead of an object', () => {
      expect(() => scoring.calculateDeduction([1, 2, 3])).toThrow(ValidationError);
    });

    it('rejects null', () => {
      expect(() => scoring.calculateDeduction(null)).toThrow(ValidationError);
    });
  });

  describe('calculateStalenessPenalty', () => {
    it('returns zero when a scan just ran', () => {
      expect(scoring.calculateStalenessPenalty(0)).toBe(0);
    });

    it('applies half a point per day', () => {
      expect(scoring.calculateStalenessPenalty(10)).toBe(5);
    });

    it('caps the penalty at the configured maximum', () => {
      expect(scoring.calculateStalenessPenalty(365)).toBe(15);
    });

    it('rejects a negative number of days', () => {
      expect(() => scoring.calculateStalenessPenalty(-5)).toThrow(ValidationError);
    });

    it('rejects a non-numeric input', () => {
      expect(() => scoring.calculateStalenessPenalty('ten')).toThrow(ValidationError);
    });
  });

  describe('getRating', () => {
    it.each([
      [100, 'HEALTHY'],
      [80,  'HEALTHY'],
      [79,  'MODERATE'],
      [60,  'MODERATE'],
      [59,  'AT_RISK'],
      [40,  'AT_RISK'],
      [39,  'CRITICAL'],
      [0,   'CRITICAL']
    ])('maps a score of %i to %s', (score, expected) => {
      expect(scoring.getRating(score)).toBe(expected);
    });

    it('rejects a non-numeric score', () => {
      expect(() => scoring.getRating('high')).toThrow(ValidationError);
    });
  });

  describe('calculateHealthScore', () => {
    it('returns a perfect score for a clean project', () => {
      const result = scoring.calculateHealthScore({ findings: {} });
      expect(result.score).toBe(100);
      expect(result.rating).toBe('HEALTHY');
      expect(result.totalFindings).toBe(0);
    });

    it('deducts correctly for a mixed set of findings', () => {
      const result = scoring.calculateHealthScore({
        findings: { critical: 1, high: 1, medium: 1, low: 1 }
      });
      // 100 - (25 + 12 + 5 + 1) = 57
      expect(result.score).toBe(57);
      expect(result.rating).toBe('AT_RISK');
      expect(result.totalFindings).toBe(4);
    });

    it('never returns a score below zero', () => {
      const result = scoring.calculateHealthScore({ findings: { critical: 20 } });
      expect(result.score).toBe(0);
      expect(result.rating).toBe('CRITICAL');
    });

    it('never returns a score above one hundred', () => {
      const result = scoring.calculateHealthScore({ findings: {}, daysSinceLastScan: 0 });
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('applies the staleness penalty on top of finding deductions', () => {
      const fresh = scoring.calculateHealthScore({ findings: { medium: 2 }, daysSinceLastScan: 0 });
      const stale = scoring.calculateHealthScore({ findings: { medium: 2 }, daysSinceLastScan: 20 });
      expect(stale.score).toBeLessThan(fresh.score);
      expect(stale.stalenessPenalty).toBe(10);
    });

    it('returns a full per-severity breakdown', () => {
      const result = scoring.calculateHealthScore({ findings: { high: 3 } });
      expect(result.breakdown.high).toEqual({ count: 3, weight: 12, deduction: 36 });
      expect(result.breakdown.critical).toEqual({ count: 0, weight: 25, deduction: 0 });
    });

    it('handles being called with no arguments at all', () => {
      const result = scoring.calculateHealthScore();
      expect(result.score).toBe(100);
    });
  });

  describe('evaluateAlertCondition', () => {
    it('alerts when the score falls into the critical band', () => {
      const result = scoring.evaluateAlertCondition(30);
      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toBe('SCORE_CRITICAL');
    });

    it('alerts on a drop of twenty points or more', () => {
      const result = scoring.evaluateAlertCondition(60, 85);
      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toBe('SIGNIFICANT_SCORE_DROP');
    });

    it('alerts when a healthy project stops being healthy', () => {
      const result = scoring.evaluateAlertCondition(75, 82);
      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toBe('DROPPED_BELOW_HEALTHY');
    });

    it('does not alert for a stable healthy project', () => {
      const result = scoring.evaluateAlertCondition(90, 92);
      expect(result.shouldAlert).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('does not alert when the score improves', () => {
      const result = scoring.evaluateAlertCondition(85, 60);
      expect(result.shouldAlert).toBe(false);
    });

    it('handles a null previous score without alerting spuriously', () => {
      const result = scoring.evaluateAlertCondition(85, null);
      expect(result.shouldAlert).toBe(false);
    });
  });

  describe('integration of scoring and alerting', () => {
    it('produces a critical rating and an alert for a badly compromised project', () => {
      const result = scoring.calculateHealthScore({
        findings: { critical: 2, high: 3, medium: 5 },
        daysSinceLastScan: 5,
        previousScore: 80
      });
      expect(result.rating).toBe('CRITICAL');
      expect(result.alert.shouldAlert).toBe(true);
    });

    it('matches the Smishing Detection demo scenario from the dashboard', () => {
      // 4 critical, 7 high, 12 medium, 3 low with a 3-hour-old scan
      const result = scoring.calculateHealthScore({
        findings: { critical: 4, high: 7, medium: 12, low: 3 }
      });
      expect(result.score).toBe(0);
      expect(result.rating).toBe('CRITICAL');
      expect(result.totalFindings).toBe(26);
    });
  });
});
