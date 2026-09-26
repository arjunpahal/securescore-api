'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/**
 * Issue a signed JWT for an authenticated user.
 * @param {{ id: string, email: string, role: string }} user
 * @returns {string} signed token
 */
function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn, issuer: 'securescore-api' }
  );
}

/**
 * Verify a token and return its decoded payload.
 * @param {string} token
 * @returns {Object} decoded payload
 * @throws {UnauthorizedError} when the token is missing, malformed or expired
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret, { issuer: 'securescore-api' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token has expired');
    }
    throw new UnauthorizedError('Invalid authentication token');
  }
}

/**
 * Express middleware enforcing a valid Bearer token.
 * Populates req.user on success.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = header.slice(7).trim();
  if (!token) {
    return next(new UnauthorizedError('Empty bearer token'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Express middleware factory enforcing role-based access control.
 * @param  {...string} allowedRoles
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requires one of roles: ${allowedRoles.join(', ')}`));
    }
    return next();
  };
}

module.exports = { issueToken, verifyToken, authenticate, authorize };
