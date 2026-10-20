const jwt = require('jsonwebtoken');
const env = require('../config/env');

// The role is embedded in the token so admin checks do not need a DB round
// trip on every request. Tokens are short-lived relative to role changes.
function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

// Short-lived access token, paired with a refresh token. Keeping the access
// token short is what bounds the damage from a leaked one: the refresh token is
// the only thing that can mint a new access token, and it is signed with a
// different secret so an access token cannot be replayed as a refresh token.
function signAccessToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username, role: user.role, typ: 'access' },
    env.jwtSecret,
    { expiresIn: env.accessTokenTtl }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), typ: 'refresh' },
    env.refreshTokenSecret,
    { expiresIn: `${env.refreshTokenTtlDays}d` }
  );
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.refreshTokenSecret);
  // Reject an access token presented as a refresh token, which would otherwise
  // let a short-lived credential be exchanged for a long-lived one.
  if (payload.typ !== 'refresh') throw new Error('Tipo de token inválido');
  return payload;
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    phoneVerified: Boolean(user.phoneVerified),
    emailVerified: Boolean(user.emailVerified),
    hasPassword: Boolean(user.password),
    role: user.role,
    profile: user.profile,
    wallet: user.wallet,
    stats: user.stats,
  };
}

module.exports = {
  signToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  publicUser,
};
