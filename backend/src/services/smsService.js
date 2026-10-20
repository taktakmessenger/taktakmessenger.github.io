const env = require('../config/env');
const { maskPhone } = require('./phoneService');

/**
 * Deliver an SMS.
 *
 * Two modes, and the difference is deliberate:
 *
 *  - With SMS_PROVIDER=twilio and credentials, the message is actually sent.
 *  - Without a provider, the code is logged and the call reports `delivered:
 *    false`. That is what makes the flow testable locally.
 *
 * The important part is that this never *pretends* to have sent a message. The
 * route surfaces `delivered` to the client, so a deployment that forgot to
 * configure a provider shows the user a clear failure instead of a "code sent"
 * screen for a message that will never arrive.
 */
async function sendSms({ to, body }) {
  if (!env.smsProvider) {
    console.log(`[SMS:dev] Para ${maskPhone(to)} — código ${body}`);
    return { delivered: false, reason: 'no_provider' };
  }

  if (env.smsProvider !== 'twilio') {
    throw new Error(`Proveedor SMS desconocido: ${env.smsProvider}`);
  }

  if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioFromNumber) {
    throw new Error('Twilio requiere TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM_NUMBER');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: to,
    From: env.twilioFromNumber,
    Body: body,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${env.twilioAccountSid}:${env.twilioAuthToken}`
      ).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    // Twilio returns a JSON error body with the reason. Read it, but do not
    // forward it verbatim to the client: it can contain account details.
    const detail = await response.text();
    console.error('[SMS] Twilio rechazó el envío:', response.status, detail.slice(0, 300));
    throw new Error('No se pudo enviar el SMS');
  }

  return { delivered: true, reason: null };
}

function isConfigured() {
  return Boolean(
    env.smsProvider &&
      env.twilioAccountSid &&
      env.twilioAuthToken &&
      env.twilioFromNumber
  );
}

module.exports = { sendSms, isConfigured };
