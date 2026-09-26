'use strict';

const db = require('../config/database');

/**
 * Data access layer for projects.
 */

async function findAll({ limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.repository_url, p.owner_id, p.current_score,
            p.rating, p.last_scanned_at, p.created_at,
            u.name AS owner_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     ORDER BY p.current_score ASC NULLS LAST, p.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT id, name, description, repository_url, owner_id,
            current_score, rating, last_scanned_at, created_at, updated_at
     FROM projects WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findByName(name) {
  const { rows } = await db.query('SELECT id, name FROM projects WHERE name = $1', [name]);
  return rows[0] || null;
}

async function create({ name, description, repositoryUrl, ownerId }) {
  const { rows } = await db.query(
    `INSERT INTO projects (name, description, repository_url, owner_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, repository_url, owner_id,
               current_score, rating, created_at`,
    [name, description, repositoryUrl, ownerId]
  );
  return rows[0];
}

async function update(id, { name, description, repositoryUrl }) {
  const { rows } = await db.query(
    `UPDATE projects
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         repository_url = COALESCE($4, repository_url),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, description, repository_url, current_score, rating, updated_at`,
    [id, name, description, repositoryUrl]
  );
  return rows[0] || null;
}

async function updateScore(id, { score, rating }) {
  const { rows } = await db.query(
    `UPDATE projects
     SET current_score = $2, rating = $3, last_scanned_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, current_score, rating, last_scanned_at`,
    [id, score, rating]
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getStatistics() {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS total_projects,
       COUNT(*) FILTER (WHERE rating = 'CRITICAL')::int AS critical_count,
       COUNT(*) FILTER (WHERE rating = 'AT_RISK')::int AS at_risk_count,
       COUNT(*) FILTER (WHERE rating = 'MODERATE')::int AS moderate_count,
       COUNT(*) FILTER (WHERE rating = 'HEALTHY')::int AS healthy_count,
       COALESCE(ROUND(AVG(current_score))::int, 0) AS average_score
     FROM projects`
  );
  return rows[0];
}

module.exports = {
  findAll, findById, findByName, create, update,
  updateScore, remove, getStatistics
};
