const crypto = require('crypto');
const env = require('../config/env');
const { HttpError } = require('../utils/http');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
// Google rotates its signing keys, so a cached set is reused but never trusted
// for longer than the response's own max-age.
const DEFAULT_CACHE_MS = 60 * 60 * 1000;

let cache = { keys: null, fetchedAt: 0, maxAgeMs: DEFAULT_CACHE_MS };

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

async function fetchKeys(force = false) {
  const fresh = cache.keys && Date.now() - cache.fetchedAt < cache.maxAgeMs;
  if (fresh && !force) return cache.keys;

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'No se pudo verificar el token de Google');

  const body = await res.json();
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]);

  cache = {
    keys: body.keys,
    fetchedAt: Date.now(),
    maxAgeMs: Number.isFinite(maxAge) ? maxAge * 1000 : DEFAULT_CACHE_MS,
  };
  return cache.keys;
}

function verifySignature({ signingInput, signature, jwk }) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(signingInput),
    key,
    Buffer.from(signature, 'base64url')
  );
}

/**
 * Verify a Google ID token and return its claims.
 *
 * Every check below is load-bearing. Skipping any one of them means accepting
 * an attacker-supplied token:
 *
 *  - signature against Google's published keys: proves Google issued it
 *  - `aud` equals our client id: proves it was issued *for this app*, not for
 *    any other app the attacker controls
 *  - `iss` is Google: proves the key set is the right one
 *  - `exp`/`iat` are sane: bounds replay of a leaked token
 *  - `email_verified`: an unverified Google email must not be allowed to claim
 *    an account that already exists under that address
 *
 * The library that would normally do this (google-auth-library) pulls in a
 * large dependency tree for one endpoint, so the verification is done directly
 * against the JWKS endpoint.
 */
async function verifyGoogleIdToken(idToken) {
  if (!env.googleClientId) {
    throw new HttpError(503, 'El inicio de sesión con Google no está configurado');
  }
  if (!idToken || typeof idToken !== 'string') {
    throw new HttpError(400, 'Token de Google requerido');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(400, 'Token de Google malformado');

  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = decodeSegment(headerB64);
    payload = decodeSegment(payloadB64);
  } catch {
    throw new HttpError(400, 'Token de Google malformado');
  }

  if (header.alg !== 'RS256') throw new HttpError(400, 'Algoritmo de firma no soportado');

  // Refuse tokens whose key is not in the published set before doing any
  // expensive crypto work.
  let jwk = (await fetchKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await fetchKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Firma de Google desconocida');

  if (!verifySignature({
    signingInput: `${headerB64}.${payloadB64}`,
    signature: signatureB64,
    jwk,
  })) {
    throw new HttpError(401, 'Firma de Google inválida');
  }

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new HttpError(401, 'Emisor de Google inválido');
  }
  if (payload.aud !== env.googleClientId) {
    throw new HttpError(401, 'Token de Google emitido para otra aplicación');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new HttpError(401, 'Token de Google expirado');
  }
  // Small tolerance for clock skew between this host and Google.
  if (typeof payload.iat === 'number' && payload.iat > now + 60) {
    throw new HttpError(401, 'Token de Google con fecha futura');
  }

  if (!payload.sub) throw new HttpError(401, 'Token de Google sin identificador de usuario');

  return {
    googleId: payload.sub,
    email: payload.email ? String(payload.email).toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

function isConfigured() {
  return Boolean(env.googleClientId);
}

module.exports = { verifyGoogleIdToken, isConfigured };
