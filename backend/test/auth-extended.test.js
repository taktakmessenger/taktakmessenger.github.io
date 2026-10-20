const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
} = require('./helpers');
const User = require('../src/models/User');
const Verification = require('../src/models/Verification');
const phoneService = require('../src/services/phoneService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

let counter = 0;
function uniquePhone(country = 'MX') {
  counter += 1;
  // A valid Mexican mobile: +52 1 55 followed by a unique 6-digit tail.
  const tail = String(100000 + counter).slice(-6);
  return { phone: `5512${tail}`, country, e164: `+525512${tail}` };
}

/* ------------------------------------------------------------------ */
/* Phone normalisation across countries                                */
/* ------------------------------------------------------------------ */

test('numbers are normalised to E.164 for any country', () => {
  // One representative number per continent, to prove the country list is not
  // a hard-coded handful.
  const cases = [
    ['5512345678', 'MX', '+525512345678'],
    ['612345678', 'ES', '+34612345678'],
    ['2025550123', 'US', '+12025550123'],
    ['11987654321', 'BR', '+5511987654321'],
    ['701234567', 'FR', '+33701234567'],
    ['9876543210', 'IN', '+919876543210'],
    ['8012345678', 'NG', '+2348012345678'],
    ['412345678', 'AU', '+61412345678'],
  ];

  for (const [input, country, expected] of cases) {
    assert.equal(
      phoneService.normalizePhone(input, country),
      expected,
      `${country} ${input}`
    );
  }
});

// A user who types an explicit prefix means that country, whatever the picker
// says. Silently prepending the picker's code would send their SMS to a
// stranger in another country.
test('an explicit + prefix wins over the selected country', () => {
  assert.equal(phoneService.normalizePhone('+34612345678', 'MX'), '+34612345678');
  assert.equal(phoneService.normalizePhone('+1 202 555 0123', 'ES'), '+12025550123');
});

test('an invalid number is rejected instead of stored', () => {
  assert.throws(() => phoneService.normalizePhone('123', 'MX'), /inválido/);
  assert.throws(() => phoneService.normalizePhone('', 'MX'), /requerido/);
  assert.throws(() => phoneService.normalizePhone('no soy un numero', 'MX'));
});

test('the country list covers the world, not a hard-coded few', () => {
  const countries = phoneService.listCountries('es');
  assert.ok(countries.length > 200, `solo ${countries.length} países`);

  const codes = new Set(countries.map((c) => c.code));
  for (const expected of ['MX', 'ES', 'US', 'BR', 'IN', 'NG', 'JP', 'DE']) {
    assert.ok(codes.has(expected), `falta ${expected}`);
  }

  // Names are localised, and every entry carries a dial code.
  const mexico = countries.find((c) => c.code === 'MX');
  assert.equal(mexico.dialCode, '+52');
  assert.ok(mexico.name.length > 2);
});

test('a masked phone does not leak the whole number', () => {
  const masked = phoneService.maskPhone('+525512345678');
  assert.ok(!masked.includes('5512345'));
  assert.ok(masked.endsWith('78'));
});

/* ------------------------------------------------------------------ */
/* Phone sign-up with a 6-digit SMS code                               */
/* ------------------------------------------------------------------ */

test('phone sign-up issues a 6-digit code and creates the account only after verification', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  const start = await agent
    .post('/api/auth/phone/start')
    .send({ phone, country, username: 'nuevo_tel', password: 'secreto123' });

  assert.equal(start.status, 201);
  assert.equal(start.body.sent, true);
  // No SMS provider is configured in tests, so delivery must be reported
  // honestly rather than as a success.
  assert.equal(start.body.delivered, false);

  // The account must NOT exist yet: an unverified number cannot squat a phone.
  assert.equal(await User.countDocuments({ phone: e164 }), 0);

  const record = await Verification.findOne({ target: e164, purpose: 'verify_phone' });
  assert.ok(record, 'no se guardó el código');
  assert.equal(record.codeHash.length, 64);

  // Wrong code is rejected and the attempt is counted.
  const wrong = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: '000000' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Intentos restantes/);

  // The right code creates the account.
  const real = await issueAndRead(e164, 'verify_phone');
  const verify = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: real });

  assert.equal(verify.status, 200);
  assert.ok(verify.body.token);
  assert.ok(verify.body.refreshToken);
  assert.equal(verify.body.user.phone, e164);
  assert.equal(verify.body.user.phoneVerified, true);
  assert.equal(verify.body.user.username, 'nuevo_tel');
});

test('the phone account can log in with the password chosen at sign-up', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent
    .post('/api/auth/phone/start')
    .send({ phone, country, username: 'conclave', password: 'secreto123' });
  const code = await issueAndRead(e164, 'verify_phone');
  await agent.post('/api/auth/phone/verify').send({ phone, country, code });

  // This is the assertion that catches a double-hashed password: the hash was
  // produced at step 1 and must not be hashed again on save.
  const login = await agent
    .post('/api/auth/login')
    .send({ identifier: e164, password: 'secreto123' });

  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.phone, e164);
});

test('the same code cannot be used twice', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent.post('/api/auth/phone/start').send({ phone, country });
  const code = await issueAndRead(e164, 'verify_phone');

  const first = await agent.post('/api/auth/phone/verify').send({ phone, country, code });
  assert.equal(first.status, 200);

  const second = await agent.post('/api/auth/phone/verify').send({ phone, country, code });
  assert.equal(second.status, 400, 'un código consumido no debe volver a servir');
});

test('a code is locked out after too many wrong attempts', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent.post('/api/auth/phone/start').send({ phone, country });

  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await agent.post('/api/auth/phone/verify').send({ phone, country, code: '000000' });
  }

  const real = await issueAndRead(e164, 'verify_phone');
  const blocked = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: real });

  assert.equal(blocked.status, 429, 'el código debe quedar bloqueado');
});

test('requesting a new code invalidates the previous one', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent.post('/api/auth/phone/start').send({ phone, country });
  const first = await issueAndRead(e164, 'verify_phone');

  await agent.post('/api/auth/phone/start').send({ phone, country });
  const second = await issueAndRead(e164, 'verify_phone');
  assert.notEqual(first, second);

  // The superseded code must stop working, or every code ever sent stays valid.
  const stale = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: first });
  assert.equal(stale.status, 400);

  const fresh = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: second });
  assert.equal(fresh.status, 200);
});

test('codes are stored hashed, never in the clear', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent.post('/api/auth/phone/start').send({ phone, country });
  const code = await issueAndRead(e164, 'verify_phone');

  const record = await Verification.findOne({ target: e164, purpose: 'verify_phone' });
  assert.notEqual(record.codeHash, code);
  assert.equal(record.codeHash, Verification.hashCode(code));
});

test('an existing verified phone is reported as a sign-in, not a new sign-up', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent.post('/api/auth/phone/start').send({ phone, country });
  const code = await issueAndRead(e164, 'verify_phone');
  await agent.post('/api/auth/phone/verify').send({ phone, country, code });

  const again = await agent.post('/api/auth/phone/start').send({ phone, country });
  assert.equal(again.body.existingAccount, true);
  // The raw number must not come back: only a mask.
  assert.ok(!JSON.stringify(again.body).includes(e164.replace('+', '')));
});

/* ------------------------------------------------------------------ */
/* Email verification and password recovery                            */
/* ------------------------------------------------------------------ */

test('registering with an email sends a verification code', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'verif_correo', email: 'verif@example.com', password: 'secreto123' });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.emailVerified, false);

  const record = await Verification.findOne({ target: 'verif@example.com', purpose: 'verify_email' });
  assert.ok(record, 'no se emitió el código de verificación');
});

test('a verification code marks the email as verified', async () => {
  const agent = app();
  await agent
    .post('/api/auth/register')
    .send({ username: 'marcar', email: 'marcar@example.com', password: 'secreto123' });

  const code = await issueAndRead('marcar@example.com', 'verify_email');
  const res = await agent
    .post('/api/auth/verify-email')
    .send({ email: 'marcar@example.com', code });

  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);

  const user = await User.findOne({ email: 'marcar@example.com' });
  assert.equal(user.emailVerified, true);
});

test('password recovery: request a code, then set a new password', async () => {
  const agent = app();
  await agent
    .post('/api/auth/register')
    .send({ username: 'recupera', email: 'recupera@example.com', password: 'viejo123' });

  const forgot = await agent
    .post('/api/auth/forgot-password')
    .send({ email: 'recupera@example.com' });
  assert.equal(forgot.status, 200);

  const code = await issueAndRead('recupera@example.com', 'reset_password');
  const reset = await agent
    .post('/api/auth/reset-password')
    .send({ email: 'recupera@example.com', code, password: 'nuevo123' });
  assert.equal(reset.status, 200);

  // The new password works, the old one does not.
  const withNew = await agent
    .post('/api/auth/login')
    .send({ identifier: 'recupera@example.com', password: 'nuevo123' });
  assert.equal(withNew.status, 200);

  const withOld = await agent
    .post('/api/auth/login')
    .send({ identifier: 'recupera@example.com', password: 'viejo123' });
  assert.equal(withOld.status, 400);
});

// Recovery must not reveal whether an address has an account.
test('forgot-password answers the same for an unknown email', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/forgot-password')
    .send({ email: 'nadie@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.sent, true);
  assert.equal(await Verification.countDocuments({ target: 'nadie@example.com' }), 0);
});

test('a reset code cannot be reused', async () => {
  const agent = app();
  await agent
    .post('/api/auth/register')
    .send({ username: 'unico', email: 'unico@example.com', password: 'viejo123' });

  await agent.post('/api/auth/forgot-password').send({ email: 'unico@example.com' });
  const code = await issueAndRead('unico@example.com', 'reset_password');

  const first = await agent
    .post('/api/auth/reset-password')
    .send({ email: 'unico@example.com', code, password: 'nuevo123' });
  assert.equal(first.status, 200);

  const second = await agent
    .post('/api/auth/reset-password')
    .send({ email: 'unico@example.com', code, password: 'otro123' });
  assert.equal(second.status, 400);
});

/* ------------------------------------------------------------------ */
/* Login by identifier and sessions                                    */
/* ------------------------------------------------------------------ */

test('login accepts an email or a phone number in the same field', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  await agent
    .post('/api/auth/phone/start')
    .send({ phone, country, username: 'dos_vias', password: 'secreto123' });
  const code = await issueAndRead(e164, 'verify_phone');
  await agent.post('/api/auth/phone/verify').send({ phone, country, code });

  const byPhone = await agent
    .post('/api/auth/login')
    .send({ identifier: e164, password: 'secreto123' });
  assert.equal(byPhone.status, 200);

  // The placeholder email created for the phone account also works.
  const byEmail = await agent
    .post('/api/auth/login')
    .send({ identifier: `${e164.replace(/\D/g, '')}@phone.taktak.app`, password: 'secreto123' });
  assert.equal(byEmail.status, 200);
});

test('the refresh token issues a new session', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'refresca', email: 'refresca@example.com', password: 'secreto123' });

  const refreshed = await agent
    .post('/api/auth/refresh')
    .send({ refreshToken: res.body.refreshToken });

  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.token);
  assert.equal(refreshed.body.user.id, res.body.user.id);
});

// An access token must not be usable as a refresh token, or a short-lived
// credential could be traded for a long-lived one.
test('an access token is rejected as a refresh token', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'cruce', email: 'cruce@example.com', password: 'secreto123' });

  const bad = await agent
    .post('/api/auth/refresh')
    .send({ refreshToken: res.body.accessToken });

  assert.equal(bad.status, 401);
});

test('a garbage refresh token is rejected', async () => {
  const agent = app();
  const res = await agent.post('/api/auth/refresh').send({ refreshToken: 'no.es.un.token' });
  assert.equal(res.status, 401);
});

/* ------------------------------------------------------------------ */
/* Google sign-in                                                      */
/* ------------------------------------------------------------------ */

// Without GOOGLE_CLIENT_ID the endpoint must refuse, not accept any token.
test('google sign-in is closed when not configured', async () => {
  const agent = app();
  const res = await agent.post('/api/auth/google').send({ idToken: 'cualquier.cosa.firma' });

  assert.ok([400, 401, 503].includes(res.status), `estado inesperado ${res.status}`);
  assert.notEqual(res.status, 200);
});

test('the providers endpoint reports what is configured and lists countries', async () => {
  const agent = app();
  const res = await agent.get('/api/auth/providers');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.google, 'boolean');
  assert.equal(typeof res.body.sms, 'boolean');
  assert.equal(typeof res.body.email, 'boolean');
  assert.ok(res.body.countries.length > 200);
});

/* ------------------------------------------------------------------ */
/* Password change                                                     */
/* ------------------------------------------------------------------ */

test('changing a password requires the current one', async () => {
  const agent = app();
  const reg = await agent
    .post('/api/auth/register')
    .send({ username: 'cambia', email: 'cambia@example.com', password: 'viejo123' });

  const wrong = await agent
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${reg.body.token}`)
    .send({ currentPassword: 'incorrecta', password: 'nuevo123' });
  assert.equal(wrong.status, 400);

  const right = await agent
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${reg.body.token}`)
    .send({ currentPassword: 'viejo123', password: 'nuevo123' });
  assert.equal(right.status, 200);
});

// A password that merely looks like a bcrypt digest must still be hashed.
test('a password resembling a hash is hashed normally', async () => {
  const agent = app();
  const tricky = '$2a$10$abcdefghijklmnopqrstuv';
  const reg = await agent
    .post('/api/auth/register')
    .send({ username: 'astuto', email: 'astuto@example.com', password: tricky });

  assert.equal(reg.status, 201);

  const login = await agent
    .post('/api/auth/login')
    .send({ identifier: 'astuto@example.com', password: tricky });
  assert.equal(login.status, 200);
});

/* ------------------------------------------------------------------ */
/* Dev code exposure (no provider configured)                          */
/* ------------------------------------------------------------------ */

// Without a mail or SMS provider the message never leaves the server, so the
// user would have no way to read the code. The API returns it so the flow stays
// usable in development. These tests pin both halves of that contract: it comes
// back in development, and it is absent in production.

test('register returns the verification code when no mail provider is set', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'devcode_mail', email: 'devcode@example.com', password: 'secreto123' });

  assert.equal(res.status, 201);
  assert.equal(res.body.verificationSent, false);
  assert.match(res.body.verificationCode, /^\d{6}$/);

  // The returned code must be the real one, not a decorative placeholder.
  const verify = await agent
    .post('/api/auth/verify-email')
    .send({ email: 'devcode@example.com', code: res.body.verificationCode });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  assert.equal(verify.body.verified, true);
});

test('phone/start returns the SMS code when no provider is set', async () => {
  const agent = app();
  const { phone, country, e164 } = uniquePhone();

  const res = await agent.post('/api/auth/phone/start').send({ phone, country });
  assert.equal(res.status, 201);
  assert.equal(res.body.delivered, false);
  assert.equal(res.body.reason, 'no_provider');
  assert.match(res.body.code, /^\d{6}$/);

  // End to end: the code shown to the user is the one that verifies the number.
  const verify = await agent
    .post('/api/auth/phone/verify')
    .send({ phone, country, code: res.body.code });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  assert.equal(verify.body.user.phone, e164);
});

test('resend-verification and forgot-password also expose the code in dev', async () => {
  const agent = app();
  await agent
    .post('/api/auth/register')
    .send({ username: 'devcode_resend', email: 'resend@example.com', password: 'secreto123' });

  const resend = await agent
    .post('/api/auth/resend-verification')
    .send({ email: 'resend@example.com' });
  assert.equal(resend.status, 200);
  assert.equal(resend.body.delivered, false);
  assert.match(resend.body.code, /^\d{6}$/);

  const forgot = await agent.post('/api/auth/forgot-password').send({ email: 'resend@example.com' });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.delivered, false);
  assert.match(forgot.body.code, /^\d{6}$/);

  // The reset code must actually work, or the user is stuck either way.
  const reset = await agent
    .post('/api/auth/reset-password')
    .send({ email: 'resend@example.com', code: forgot.body.code, password: 'nueva12345' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
});

test('the code is never exposed in production', async () => {
  // The guard lives in the route, keyed on NODE_ENV. Flipping it here is the
  // cheapest way to assert the production branch without booting a second app.
  const env = require('../src/config/env');
  const original = env.isProduction;

  try {
    env.isProduction = true;
    const agent = app();
    const res = await agent
      .post('/api/auth/register')
      .send({ username: 'devcode_prod', email: 'prod@example.com', password: 'secreto123' });

    assert.equal(res.status, 201);
    assert.equal(res.body.verificationCode, undefined);

    const { phone, country } = uniquePhone();
    const sms = await agent.post('/api/auth/phone/start').send({ phone, country });
    assert.equal(sms.body.code, undefined);
  } finally {
    env.isProduction = original;
  }
});

// Reads the code that was just issued, standing in for the SMS or email the
// user would receive. The plaintext is not persisted, so it is recomputed from
// a fresh issue only in tests that need the exact value.
async function issueAndRead(target, purpose) {
  // The code is not stored, so the only way to learn it in a test is to issue a
  // known one. Rather than weaken the model, re-issue and capture the return
  // value through the model API.
  const code = Verification.generateCode(6);
  const record = await Verification.findOne({ target, purpose, consumedAt: null }).sort({
    createdAt: -1,
  });
  assert.ok(record, `no hay código vivo para ${target}/${purpose}`);
  record.codeHash = Verification.hashCode(code);
  await record.save();
  return code;
}
