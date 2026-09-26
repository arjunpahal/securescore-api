'use strict';

const { httpRequestsTotal, httpRequestDuration } = require('../utils/metrics');

/**
 * Records request count and duration for every HTTP request.
 * The route pattern (not the raw URL) is used as a label to avoid
 * unbounded metric cardinality from path parameters.
 */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode)
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationSeconds);
  });

  next();
}

module.exports = metricsMiddleware;
