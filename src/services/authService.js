'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');
const userModel = require('../models/userModel');
const { issueToken } = require('../middleware/auth');
const { UnauthorizedError, ConflictError } = require('../utils/errors');
const { authAttemptsTotal } = require('../utils/metrics');

/**
 * Register a new user.
 * Passwords are hashed with bcrypt before storage — plain text passwords
 * are never persisted or logged.
 */
async function register({ email, name, password, role = 'developer' }) {
  const existing = await userModel.findByEmail(email);
  if (existing) {
    throw new ConflictError('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const user = await userModel.create({ email, name, passwordHash, role });

  return { user, token: issueToken(user) };
}

/**
 * Authenticate a user and return a JWT.
 * A generic error message is returned for both unknown email and wrong
 * password so an attacker cannot enumerate valid accounts.
 */
async function login({ email, password }) {
  const user = await userModel.findByEmail(email);

  if (!user) {
    authAttemptsTotal.inc({ outcome: 'failure' });
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    authAttemptsTotal.inc({ outcome: 'failure' });
    throw new UnauthorizedError('Invalid email or password');
  }

  authAttemptsTotal.inc({ outcome: 'success' });

  const safeUser = {
    id: user.id, email: user.email, name: user.name, role: user.role
  };
  return { user: safeUser, token: issueToken(safeUser) };
}

module.exports = { register, login };
