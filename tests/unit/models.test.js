'use strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

jest.mock('../../src/config/database');

const db = require('../../src/config/database');
const userModel = require('../../src/models/userModel');
const projectModel = require('../../src/models/projectModel');
const scanModel = require('../../src/models/scanModel');
const alertModel = require('../../src/models/alertModel');

/**
 * Model-layer tests. The database driver is mocked, so these verify
 * that each model issues the correct parameterised SQL and maps the
 * result shape correctly — without needing a live database.
 *
 * The assertions on parameter binding matter for security: they prove
 * that user input is never interpolated into SQL strings.
 */
describe('data models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('userModel', () => {
    it('findByEmail lowercases the email and binds it as a parameter', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'a@b.com' }] });
      await userModel.findByEmail('A@B.COM');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('$1');
      expect(params).toEqual(['a@b.com']);
    });

    it('findByEmail returns null when no row matches', async () => {
      expect(await userModel.findByEmail('nobody@b.com')).toBeNull();
    });

    it('findById binds the id as a parameter', async () => {
      await userModel.findById('u1');
      expect(db.query.mock.calls[0][1]).toEqual(['u1']);
    });

    it('create never includes the raw password in the SQL', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
      await userModel.create({
        email: 'a@b.com', name: 'A', passwordHash: '$2a$10$hash', role: 'developer'
      });
      const [sql] = db.query.mock.calls[0];
      expect(sql).not.toContain('a@b.com');
      expect(sql).toContain('$1');
    });

    it('countAll returns the integer total', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ total: 7 }] });
      expect(await userModel.countAll()).toBe(7);
    });
  });

  describe('projectModel', () => {
    it('findAll applies limit and offset as bound parameters', async () => {
      await projectModel.findAll({ limit: 10, offset: 20 });
      expect(db.query.mock.calls[0][1]).toEqual([10, 20]);
    });

    it('findAll uses sensible defaults', async () => {
      await projectModel.findAll();
      expect(db.query.mock.calls[0][1]).toEqual([50, 0]);
    });

    it('findById returns null when the project is absent', async () => {
      expect(await projectModel.findById('missing')).toBeNull();
    });

    it('create binds all supplied fields', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      await projectModel.create({
        name: 'Test', description: 'desc',
        repositoryUrl: 'https://github.com/x/y', ownerId: 'u1'
      });
      expect(db.query.mock.calls[0][1]).toEqual(['Test', 'desc', 'https://github.com/x/y', 'u1']);
    });

    it('updateScore binds the score and rating', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'p1', current_score: 85 }] });
      await projectModel.updateScore('p1', { score: 85, rating: 'HEALTHY' });
      expect(db.query.mock.calls[0][1]).toEqual(['p1', 85, 'HEALTHY']);
    });

    it('remove reports false when nothing was deleted', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 0 });
      expect(await projectModel.remove('missing')).toBe(false);
    });

    it('remove reports true when a row was deleted', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });
      expect(await projectModel.remove('p1')).toBe(true);
    });

    it('getStatistics returns the aggregate row', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ total_projects: 5, critical_count: 1, average_score: 70 }]
      });
      const stats = await projectModel.getStatistics();
      expect(stats.total_projects).toBe(5);
      expect(stats.average_score).toBe(70);
    });
  });

  describe('scanModel', () => {
    it('create runs inside a transaction', async () => {
      db.transaction.mockImplementation(async (cb) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ id: 'scan-1' }] }) }));

      await scanModel.create({
        projectId: 'p1', findings: { high: 2 }, score: 76,
        rating: 'MODERATE', deduction: 24, stalenessPenalty: 0, triggeredBy: 'u1'
      });
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('create skips inserting findings with a zero count', async () => {
      const clientQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'scan-1' }] });
      db.transaction.mockImplementation(async (cb) => cb({ query: clientQuery }));

      await scanModel.create({
        projectId: 'p1', findings: { critical: 0, high: 1 }, score: 88,
        rating: 'HEALTHY', deduction: 12, stalenessPenalty: 0, triggeredBy: 'u1'
      });

      // 1 insert for the scan + 1 insert for the single non-zero finding
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });

    it('findById returns null when the scan is absent', async () => {
      expect(await scanModel.findById('missing')).toBeNull();
    });

    it('getLatestScore returns null when no scans exist', async () => {
      expect(await scanModel.getLatestScore('p1')).toBeNull();
    });

    it('getLatestScore returns the numeric score', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ score: 73 }] });
      expect(await scanModel.getLatestScore('p1')).toBe(73);
    });

    it('findByProject caps the returned rows with a bound limit', async () => {
      await scanModel.findByProject('p1', { limit: 5 });
      expect(db.query.mock.calls[0][1]).toEqual(['p1', 5]);
    });
  });

  describe('alertModel', () => {
    it('create binds every alert field', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
      await alertModel.create({
        projectId: 'p1', scanId: 's1', reason: 'SCORE_CRITICAL',
        severity: 'CRITICAL', message: 'msg'
      });
      expect(db.query.mock.calls[0][1]).toEqual(['p1', 's1', 'SCORE_CRITICAL', 'CRITICAL', 'msg']);
    });

    it('findAll filters by status when one is supplied', async () => {
      await alertModel.findAll({ status: 'OPEN', limit: 10 });
      expect(db.query.mock.calls[0][1]).toEqual(['OPEN', 10]);
    });

    it('findAll omits the status filter when none is supplied', async () => {
      await alertModel.findAll({ limit: 10 });
      expect(db.query.mock.calls[0][1]).toEqual([10]);
    });

    it('acknowledge returns null when the alert is already closed', async () => {
      expect(await alertModel.acknowledge('a1', 'u1')).toBeNull();
    });

    it('countOpen returns the integer total', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ total: 3 }] });
      expect(await alertModel.countOpen()).toBe(3);
    });
  });
});
