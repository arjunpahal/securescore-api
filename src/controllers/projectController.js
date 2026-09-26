'use strict';

const projectModel = require('../models/projectModel');
const scanModel = require('../models/scanModel');
const { NotFoundError, ConflictError } = require('../utils/errors');

async function list(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const projects = await projectModel.findAll({ limit, offset });
    res.status(200).json({ data: projects, meta: { limit, offset, count: projects.length } });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const project = await projectModel.findById(req.params.id);
    if (!project) throw new NotFoundError('Project');
    res.status(200).json({ data: project });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { name, description, repositoryUrl } = req.body;
    const existing = await projectModel.findByName(name);
    if (existing) throw new ConflictError('A project with that name already exists');

    const project = await projectModel.create({
      name, description, repositoryUrl, ownerId: req.user.id
    });
    res.status(201).json({ data: project });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { name, description, repositoryUrl } = req.body;
    const project = await projectModel.update(req.params.id, { name, description, repositoryUrl });
    if (!project) throw new NotFoundError('Project');
    res.status(200).json({ data: project });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const deleted = await projectModel.remove(req.params.id);
    if (!deleted) throw new NotFoundError('Project');
    res.status(204).send();
  } catch (err) { next(err); }
}

async function getScore(req, res, next) {
  try {
    const project = await projectModel.findById(req.params.id);
    if (!project) throw new NotFoundError('Project');

    const history = await scanModel.findByProject(req.params.id, { limit: 10 });

    res.status(200).json({
      data: {
        projectId: project.id,
        projectName: project.name,
        currentScore: project.current_score,
        rating: project.rating,
        lastScannedAt: project.last_scanned_at,
        history
      }
    });
  } catch (err) { next(err); }
}

async function statistics(req, res, next) {
  try {
    const stats = await projectModel.getStatistics();
    res.status(200).json({ data: stats });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove, getScore, statistics };
