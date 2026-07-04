/*
=======================================================================================================================================
Module: utils/apiLogger.js
=======================================================================================================================================
Purpose: Lightweight request/response logging attached to every route (API-RULES: "Add API logging to every route"). Records the
         method, path, resolved user id (if any), the return_code the route responded with, and how long it took. This gives the
         owner a simple audit trail in the PM2 logs without pulling in a heavy logging framework.

Usage (in server.js): app.use(apiLogger);  — it wraps res.json so it can see the outgoing return_code and timing.
=======================================================================================================================================
*/

const logger = require('./logger');

// Express middleware. We hook res.json (the method every route uses to send the return_code envelope) so we can log the
// return_code and elapsed time exactly when the response is sent — no manual logging call needed in each route.
function apiLogger(req, res, next) {
  const startedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const ms = Date.now() - startedAt;
    // req.user is populated by verifyToken for authenticated routes; undefined for /login and /health.
    const who = req.user ? `user#${req.user.id}` : 'anon';
    const code = body && body.return_code ? body.return_code : 'NO_RETURN_CODE';
    logger.info(`[api] ${req.method} ${req.originalUrl} ${who} -> ${code} (${ms}ms)`);
    return originalJson(body);
  };

  next();
}

module.exports = apiLogger;
