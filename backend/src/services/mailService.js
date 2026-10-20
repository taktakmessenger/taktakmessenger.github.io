const nodemailer = require('nodemailer');
const env = require('../config/env');

// Built once and reused: creating a transport per message opens a new
// connection pool every time.
let transport = null;

function getTransport() {
  if (!env.smtpHost) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transport;
}

/**
 * Send an email, or log it when SMTP is not configured.
 *
 * Mirrors `smsService`: no transport means `delivered: false` and a console
 * line, never a silent success. The routes report that flag so a
 * misconfigured deployment is visible to the user instead of looking healthy.
 */
async function sendMail({ to, subject, text, html }) {
  const tx = getTransport();

  if (!tx) {
    console.log(`[MAIL:dev] Para ${to} — ${subject}\n${text}`);
    return { delivered: false, reason: 'no_provider' };
  }

  await tx.sendMail({ from: env.mailFrom, to, subject, text, html });
  return { delivered: true, reason: null };
}

function isConfigured() {
  return Boolean(env.smtpHost);
}

// Reset links must be absolute. `env.appUrl` is used instead of the request's
// Host header, which is attacker-controlled: a spoofed Host would produce a
// reset link pointing at the attacker's domain.
function resetUrl(token) {
  return `${env.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

module.exports = { sendMail, isConfigured, resetUrl };
