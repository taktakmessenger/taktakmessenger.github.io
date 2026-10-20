const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Verifies the bearer token and attaches the decoded payload to req.user.
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Gate for admin-only endpoints. Must run after `auth`.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  return next();
}

// Populates req.user when a valid token is present, but never rejects. Used by
// endpoints that serve anonymous visitors and enrich the response for members.
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    try {
      req.user = jwt.verify(token, env.jwtSecret);
    } catch {
      // A stale or malformed token is treated as "not logged in" rather than an
      // error, so a public page never breaks for a logged-out user.
    }
  }
  return next();
}

module.exports = { auth, requireAdmin, optionalAuth };
