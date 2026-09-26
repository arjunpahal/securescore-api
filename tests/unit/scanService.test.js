'use strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

jest.mock('../../src/models/projectModel');
jest.mock('../../src/models/scanModel');
jest.mock('../../src/models/alertModel');

const projectModel = require('../../src/models/projectModel');
const scanModel = require('../../src/models/scanModel');
const alertModel = require('../../src/models/alertModel');
const scanService = require('../../src/services/scanService');
const { NotFoundError } = require('../../src/utils/errors');

describe('scanService', () => {
  const PROJECT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const USER_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    jest.clearAllMocks();
    projectModel.findById.mockResolvedValue({
      id: PROJECT_ID, name: 'AppAttack', last_scanned_at: new Date().toISOString()
    });
    projectModel.updateScore.mockResolvedValue({ id: PROJECT_ID, current_score: 100 });
    scanModel.getLatestScore.mockResolvedValue(null);
    scanModel.create.mockImplementation(async (args) => ({
      id: 'scan-1', project_id: args.projectId, score: args.score,
      rating: args.rating, created_at: new Date().toISOString()
    }));
    alertModel.create.mockResolvedValue({ id: 'alert-1', reason: 'SCORE_CRITICAL' });
  });

  describe('daysSince', () => {
    it('returns zero for a null timestamp', () => {
      expect(scanService.daysSince(null)).toBe(0);
    });

    it('returns zero for a timestamp from right now', () => {
      expect(scanService.daysSince(new Date().toISOString())).toBe(0);
    });

    it('returns the correct whole number of days elapsed', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      expect(scanService.daysSince(tenDaysAgo)).toBe(10);
    });

    it('never returns a negative value for a future timestamp', () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      expect(scanService.daysSince(tomorrow)).toBe(0);
    });
  });

  describe('runScan', () => {
    it('throws NotFoundError when the project does not exist', async () => {
      projectModel.findById.mockResolvedValueOnce(null);
      await expect(
        scanService.runScan({ projectId: PROJECT_ID, findings: {}, triggeredBy: USER_ID })
      ).rejects.toThrow(NotFoundError);
    });

    it('persists a scan and updates the project score for a clean scan', async () => {
      const result = await scanService.runScan({
        projectId: PROJECT_ID, findings: {}, triggeredBy: USER_ID
      });
      expect(scanModel.create).toHaveBeenCalledTimes(1);
      expect(projectModel.updateScore).toHaveBeenCalledWith(PROJECT_ID, {
        score: 100, rating: 'HEALTHY'
      });
      expect(result.scan.score).toBe(100);
      expect(result.alert).toBeNull();
    });

    it('raises an alert when the resulting score is critical', async () => {
      const result = await scanService.runScan({
        projectId: PROJECT_ID,
        findings: { critical: 3 },
        triggeredBy: USER_ID
      });
      expect(alertModel.create).toHaveBeenCalledTimes(1);
      expect(result.alert).not.toBeNull();
      expect(result.scan.rating).toBe('CRITICAL');
    });

    it('raises an alert with CRITICAL severity for a critical rating', async () => {
      await scanService.runScan({
        projectId: PROJECT_ID, findings: { critical: 4 }, triggeredBy: USER_ID
      });
      expect(alertModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'CRITICAL' })
      );
    });

    it('raises an alert when the score drops sharply from the previous scan', async () => {
      scanModel.getLatestScore.mockResolvedValueOnce(95);
      const result = await scanService.runScan({
        projectId: PROJECT_ID, findings: { high: 3 }, triggeredBy: USER_ID
      });
      expect(result.alert).not.toBeNull();
      expect(alertModel.create).toHaveBeenCalled();
    });

    it('does not raise an alert for a stable healthy project', async () => {
      scanModel.getLatestScore.mockResolvedValueOnce(95);
      const result = await scanService.runScan({
        projectId: PROJECT_ID, findings: { low: 2 }, triggeredBy: USER_ID
      });
      expect(result.alert).toBeNull();
      expect(alertModel.create).not.toHaveBeenCalled();
    });

    it('applies a staleness penalty for a project not scanned recently', async () => {
      const longAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      projectModel.findById.mockResolvedValueOnce({
        id: PROJECT_ID, name: 'Stale Project', last_scanned_at: longAgo
      });
      const result = await scanService.runScan({
        projectId: PROJECT_ID, findings: {}, triggeredBy: USER_ID
      });
      expect(result.scan.score).toBe(90);
      expect(result.scan.stalenessPenalty).toBe(10);
    });

    it('records which user triggered the scan', async () => {
      await scanService.runScan({
        projectId: PROJECT_ID, findings: {}, triggeredBy: USER_ID
      });
      expect(scanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: USER_ID })
      );
    });
  });

  describe('ALERT_MESSAGES', () => {
    it('defines a message for every alert reason the engine can emit', () => {
      expect(scanService.ALERT_MESSAGES).toHaveProperty('SCORE_CRITICAL');
      expect(scanService.ALERT_MESSAGES).toHaveProperty('SIGNIFICANT_SCORE_DROP');
      expect(scanService.ALERT_MESSAGES).toHaveProperty('DROPPED_BELOW_HEALTHY');
    });
  });
});
