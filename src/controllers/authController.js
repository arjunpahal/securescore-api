'use strict';

const authService = require('../services/authService');

async function register(req, res, next) {
  try {
    const { email, name, password, role } = req.body;
    const result = await authService.register({ email, name, password, role });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

async function me(req, res) {
  res.status(200).json({ data: { user: req.user } });
}

module.exports = { register, login, me };
