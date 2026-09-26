'use strict';

const db = require('../config/database');

/**
 * Data access layer for users.
 * All queries use bound parameters to prevent SQL injection.
 */

async function findByEmail(email) {
  const { rows } = await db.query(
    'SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function create({ email, name, passwordHash, role = 'developer' }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, created_at`,
    [email.toLowerCase(), name, passwordHash, role]
  );
  return rows[0];
}

async function countAll() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM users');
  return rows[0].total;
}

module.exports = { findByEmail, findById, create, countAll };
