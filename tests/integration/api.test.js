'use strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const request = require('supertest');
const createApp = require('../../src/app');
const { issueToken } = require('../../src/middleware/auth');

/**
 * Integration tests exercising the HTTP layer end to end.
 * The database is mocked so these tests run in the pipeline without
 * requiring a live PostgreSQL instance — the Deploy stage covers the
 * real database path separately via a smoke test.
 */
jest.mock('../../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: jest.fn(async (cb) => cb({ query: jest.fn().mockResolvedValue({ rows: [{}] }) })),
  healthCheck: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(undefined),
  pool: { on: jest.fn() }
}));

const db = require('../../src/config/database');

describe('SecureScore API', () => {
  let app;
  let token;

  beforeAll(() => {
    app = createApp();
    token = issueToken({ id: '11111111-1111-1111-1111-111111111111',
                         email: 'admin@deakin.edu.au', role: 'admin' });
  });

  afterEach(() => jest.clearAllMocks());

  // ------------------------------------------------------ operational ----
  describe('operational endpoints', () => {
    it('GET / returns the service descriptor', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('SecureScore API');
      expect(res.body.endpoints).toHaveProperty('health');
    });

    it('GET /health reports the service as up', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptimeSeconds');
    });

    it('GET /ready returns 200 when the database is reachable', async () => {
      db.healthCheck.mockResolvedValueOnce(true);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.checks.database).toBe('up');
    });

    it('GET /ready returns 503 when the database is unreachable', async () => {
      db.healthCheck.mockResolvedValueOnce(false);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.checks.database).toBe('down');
    });

    it('GET /metrics exposes Prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('securescore_http_requests_total');
    });
  });

  // ---------------------------------------------------------- security ----
  describe('security headers', () => {
    it('sets X-Content-Type-Options', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets a Content-Security-Policy', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('removes the X-Powered-By header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ------------------------------------------------------ authentication --
  describe('authentication', () => {
    it('rejects an unauthenticated request to a protected route', async () => {
      const res = await request(app).get('/api/v1/projects');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', 'Bearer garbage');
      expect(res.status).toBe(401);
    });

    it('accepts a valid token', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/auth/me returns the caller identity', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('admin@deakin.edu.au');
    });
  });

  // -------------------------------------------------------- validation ----
  describe('input validation', () => {
    it('rejects registration with a short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'a@b.com', name: 'Test User', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects registration with an invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', name: 'Test User', password: 'ValidPass123' });
      expect(res.status).toBe(400);
    });

    it('rejects a project with a non-URL repository', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Project', repositoryUrl: 'not-a-url' });
      expect(res.status).toBe(400);
    });

    it('rejects a project id that is not a UUID', async () => {
      const res = await request(app)
        .get('/api/v1/projects/not-a-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  // ------------------------------------------------------ scan preview ----
  describe('POST /api/v1/scans/preview', () => {
    it('scores a clean project at one hundred', async () => {
      const res = await request(app)
        .post('/api/v1/scans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ findings: {} });
      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(100);
      expect(res.body.data.rating).toBe('HEALTHY');
    });

    it('scores a compromised project as critical and flags an alert', async () => {
      const res = await request(app)
        .post('/api/v1/scans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ findings: { critical: 3, high: 2 } });
      expect(res.status).toBe(200);
      expect(res.body.data.rating).toBe('CRITICAL');
      expect(res.body.data.alert.shouldAlert).toBe(true);
    });

    it('rejects an unknown severity', async () => {
      const res = await request(app)
        .post('/api/v1/scans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ findings: { catastrophic: 1 } });
      expect(res.status).toBe(400);
    });

    it('returns a per-severity breakdown', async () => {
      const res = await request(app)
        .post('/api/v1/scans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ findings: { high: 2 } });
      expect(res.body.data.breakdown.high.deduction).toBe(24);
    });
  });

  // -------------------------------------------------------- error paths ---
  describe('error handling', () => {
    it('returns a structured 404 for an unknown route', async () => {
      const res = await request(app).get('/api/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('does not leak stack traces in non-development mode', async () => {
      db.query.mockRejectedValueOnce(new Error('simulated database failure'));
      const res = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.error).not.toHaveProperty('stack');
    });
  });
});
