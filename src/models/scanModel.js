'use strict';

const db = require('../config/database');

/**
 * Data access layer for scans and their findings.
 */

async function create({ projectId, findings, score, rating, deduction, stalenessPenalty, triggeredBy }) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO scans (project_id, score, rating, deduction, staleness_penalty, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, score, rating, created_at`,
      [projectId, score, rating, deduction, stalenessPenalty, triggeredBy]
    );
    const scan = rows[0];

    for (const [severity, count] of Object.entries(findings)) {
      if (count > 0) {
        await client.query(
          'INSERT INTO scan_findings (scan_id, severity, count) VALUES ($1, $2, $3)',
          [scan.id, severity, count]
        );
      }
    }

    return scan;
  });
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT s.id, s.project_id, s.score, s.rating, s.deduction,
            s.staleness_penalty, s.triggered_by, s.created_at,
            p.name AS project_name
     FROM scans s
     JOIN projects p ON p.id = s.project_id
     WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) return null;

  const { rows: findings } = await db.query(
    'SELECT severity, count FROM scan_findings WHERE scan_id = $1',
    [id]
  );

  return { ...rows[0], findings };
}

async function findByProject(projectId, { limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT id, score, rating, deduction, created_at
     FROM scans WHERE project_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [projectId, limit]
  );
  return rows;
}

async function getLatestScore(projectId) {
  const { rows } = await db.query(
    'SELECT score FROM scans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
    [projectId]
  );
  return rows[0] ? rows[0].score : null;
}

async function getOpenVulnerabilityCounts() {
  const { rows } = await db.query(
    `SELECT sf.severity, SUM(sf.count)::int AS total
     FROM scan_findings sf
     JOIN scans s ON s.id = sf.scan_id
     JOIN (
       SELECT project_id, MAX(created_at) AS latest
       FROM scans GROUP BY project_id
     ) latest_scans
       ON latest_scans.project_id = s.project_id
      AND latest_scans.latest = s.created_at
     GROUP BY sf.severity`
  );
  return rows;
}

module.exports = {
  create, findById, findByProject,
  getLatestScore, getOpenVulnerabilityCounts
};
