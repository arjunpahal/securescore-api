'use strict';

const db = require('../config/database');

async function create({ projectId, scanId, reason, severity, message }) {
  const { rows } = await db.query(
    `INSERT INTO alerts (project_id, scan_id, reason, severity, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, project_id, reason, severity, message, status, created_at`,
    [projectId, scanId, reason, severity, message]
  );
  return rows[0];
}

async function findAll({ status = null, limit = 50 } = {}) {
  const query = status
    ? `SELECT a.*, p.name AS project_name FROM alerts a
       JOIN projects p ON p.id = a.project_id
       WHERE a.status = $1 ORDER BY a.created_at DESC LIMIT $2`
    : `SELECT a.*, p.name AS project_name FROM alerts a
       JOIN projects p ON p.id = a.project_id
       ORDER BY a.created_at DESC LIMIT $1`;

  const params = status ? [status, limit] : [limit];
  const { rows } = await db.query(query, params);
  return rows;
}

async function acknowledge(id, userId) {
  const { rows } = await db.query(
    `UPDATE alerts
     SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = NOW()
     WHERE id = $1 AND status = 'OPEN'
     RETURNING id, status, acknowledged_at`,
    [id, userId]
  );
  return rows[0] || null;
}

async function countOpen() {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM alerts WHERE status = 'OPEN'"
  );
  return rows[0].total;
}

module.exports = { create, findAll, acknowledge, countOpen };
