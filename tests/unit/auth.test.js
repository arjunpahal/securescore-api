'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../src/config');
const { issueToken, verifyToken, authenticate, authorize } = require('../../src/middleware/auth');
const { UnauthorizedError, ForbiddenError } = require('../../src/utils/errors');

describe('auth middleware', () => {
  const user = { id: 'user-123', email: 'test@deakin.edu.au', role: 'developer' };

  describe('issueToken', () => {
    it('issues a token containing the user identity', () => {
      const token = issueToken(user);
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      expect(decoded.sub).toBe(user.id);
      expect(decoded.email).toBe(user.email);
      expect(decoded.role).toBe(user.role);
    });

    it('sets the expected issuer claim', () => {
      const decoded = jwt.decode(issueToken(user));
      expect(decoded.iss).toBe('securescore-api');
    });

    it('sets an expiry claim', () => {
      const decoded = jwt.decode(issueToken(user));
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });
  });

  describe('verifyToken', () => {
    it('accepts a token it issued itself', () => {
      const payload = verifyToken(issueToken(user));
      expect(payload.sub).toBe(user.id);
    });

    it('rejects a malformed token', () => {
      expect(() => verifyToken('not-a-real-token')).toThrow(UnauthorizedError);
    });

    it('rejects a token signed with the wrong secret', () => {
      const forged = jwt.sign({ sub: 'attacker' }, 'wrong-secret', { issuer: 'securescore-api' });
      expect(() => verifyToken(forged)).toThrow(UnauthorizedError);
    });

    it('rejects an expired token', () => {
      const expired = jwt.sign({ sub: user.id }, config.auth.jwtSecret, {
        issuer: 'securescore-api', expiresIn: '-1s'
      });
      expect(() => verifyToken(expired)).toThrow(/expired/i);
    });
  });

  describe('authenticate', () => {
    const mockRes = {};

    it('populates req.user for a valid bearer token', (done) => {
      const req = { headers: { authorization: `Bearer ${issueToken(user)}` } };
      authenticate(req, mockRes, (err) => {
        expect(err).toBeUndefined();
        expect(req.user.id).toBe(user.id);
        done();
      });
    });

    it('rejects a request with no Authorization header', (done) => {
      authenticate({ headers: {} }, mockRes, (err) => {
        expect(err).toBeInstanceOf(UnauthorizedError);
        done();
      });
    });

    it('rejects a non-bearer scheme', (done) => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
      authenticate(req, mockRes, (err) => {
        expect(err).toBeInstanceOf(UnauthorizedError);
        done();
      });
    });

    it('rejects an empty bearer token', (done) => {
      authenticate({ headers: { authorization: 'Bearer ' } }, mockRes, (err) => {
        expect(err).toBeInstanceOf(UnauthorizedError);
        done();
      });
    });
  });

  describe('authorize', () => {
    it('allows a user holding an accepted role', (done) => {
      const req = { user: { ...user, role: 'admin' } };
      authorize('admin', 'lead')(req, {}, (err) => {
        expect(err).toBeUndefined();
        done();
      });
    });

    it('blocks a user whose role is not accepted', (done) => {
      const req = { user: { ...user, role: 'developer' } };
      authorize('admin')(req, {}, (err) => {
        expect(err).toBeInstanceOf(ForbiddenError);
        done();
      });
    });

    it('blocks an unauthenticated request', (done) => {
      authorize('admin')({}, {}, (err) => {
        expect(err).toBeInstanceOf(UnauthorizedError);
        done();
      });
    });
  });
});
