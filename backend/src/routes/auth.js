const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const User = require('../models/User');
const Verification = require('../models/Verification');
const validate = require('../middleware/validate');
const { auth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../utils/http');
const {
  signToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  publicUser,
} = require('../utils/tokens');
const env = require('../config/env');
const phoneService = require('../services/phoneService');
const smsService = require('../services/smsService');
const voiceService = require('../services/voiceService');
const mailService = require('../services/mailService');
const googleService = require('../services/googleService');
const facebookService = require('../services/facebookService');

const router = express.Router();

// In tests the limiters are replaced by this no-op, so a suite that issues
// hundreds of requests is not throttled into failing.
const passthrough = (req, res, next) => next();

// Slow down credential stuffing / brute force.
const authLimiter = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiados intentos, intenta más tarde' },
    });

// Issuing a code costs money and sends a message to a third party, so it gets a
// tighter budget than a plain login attempt.
const codeLimiter = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiadas solicitudes de código, intenta más tarde' },
    });

const usernameRule = body('username')
  .trim()
  .isLength({ min: 3, max: 30 })
  .withMessage('El usuario debe tener entre 3 y 30 caracteres')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('El usuario solo puede contener letras, números y guiones bajos');

const emailRule = body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail();

const passwordRule = body('password')
  .isLength({ min: 6 })
  .withMessage('La contraseña debe tener al menos 6 caracteres');

const codeRule = body('code')
  .trim()
  .matches(/^\d{4,8}$/)
  .withMessage('Código inválido');

function session(user) {
  return {
    token: signToken(user),
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    user: publicUser(user),
  };
}

/**
 * The 6-digit code, but only when it is safe to hand back to the client.
 *
 * Without SMTP/SMS configured the message never leaves the server, so the user
 * has no way to read it: the flow looks broken ("dice que envía un código y no
 * llega"). Returning it here makes local development usable.
 *
 * In production this returns `undefined` unconditionally. Shipping the code in
 * an API response would let anyone who knows an email or phone number take over
 * that account, so the guard is on `isProduction`, not on whether a provider
 * happens to be configured.
 */
function devCode(code) {
  return env.isProduction ? undefined : code;
}

// A generated username must be unique. Deriving it from the phone digits keeps
// it recognisable, and the random suffix avoids a predictable enumeration of
// who signed up by phone.
async function generateUsername(base) {
  const cleaned = String(base || '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(-8);
  const seed = cleaned.length >= 3 ? cleaned : `user${cleaned}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${seed}_${suffix}`.slice(0, 30);
    // eslint-disable-next-line no-await-in-loop
    const taken = await User.existsByUsername(candidate);
    if (!taken) return candidate;
  }

  return `user_${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Email + password                                                    */
/* ------------------------------------------------------------------ */

router.post(
  '/register',
  authLimiter,
  [usernameRule, emailRule, passwordRule],
  validate,
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    // El índice de `username` distingue mayúsculas, pero la búsqueda pública no:
    // sin esta comprobación se podía registrar `elmalayaso` con `Elmalayaso` ya
    // existente y quedaban dos cuentas que casaban con el mismo @usuario.
    if (existing || (await User.existsByUsername(username))) {
      throw new HttpError(400, 'El usuario o email ya existe');
    }

    const user = await User.create({
      username,
      email,
      password,
      profile: { displayName: username },
      // A small starter balance lets a new account try gifts immediately.
      wallet: { bonusC: env.welcomeBonusCoins, ttcR: 0 },
    });

    // Verification mail is best-effort: a mail outage must not fail the
    // registration, or the user is left with an account they cannot use and no
    // way to retry.
    let verificationSent = false;
    let verificationCode;
    try {
      const issued = await Verification.issue({
        target: email,
        channel: 'email',
        purpose: 'verify_email',
        length: env.otpLength,
        ttlMinutes: env.otpTtlMinutes,
      });
      const result = await mailService.sendMail({
        to: email,
        subject: 'Verifica tu cuenta de TAK TAK',
        text: `Tu código de verificación es ${issued.code}. Caduca en ${env.otpTtlMinutes} minutos.`,
      });
      verificationSent = result.delivered;
      // Only when the mail could not be delivered: otherwise the code is
      // already in the user's inbox and echoing it back widens the exposure.
      if (!verificationSent) verificationCode = devCode(issued.code);
    } catch (err) {
      console.error('[auth] no se pudo enviar la verificación por correo:', err.message);
    }

    res.status(201).json({ ...session(user), verificationSent, verificationCode });
  })
);

router.post(
  '/login',
  authLimiter,
  [
    // Accepts an email or a phone number in the same field, because users do
    // not think in terms of "which identifier did I register with".
    body('identifier').optional().trim().notEmpty(),
    emailRule.optional(),
    body('password').notEmpty().withMessage('La contraseña es requerida'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const identifier = req.body.identifier || req.body.email;
    const { password } = req.body;

    if (!identifier) throw new HttpError(400, 'Email o teléfono requerido');

    // Resolve the identifier to a query. A phone is normalised first so
    // "+52 55 1234 5678" and "+525512345678" find the same account.
    let query;
    if (identifier.includes('@')) {
      query = { email: identifier.toLowerCase() };
    } else {
      const normalized = phoneService.normalizePhone(identifier, req.body.country);
      query = { phone: normalized };
    }

    const user = await User.findOne(query).select('+password');
    // Same generic message for unknown user and wrong password to avoid
    // leaking which identifiers are registered.
    if (!user || !(await user.comparePassword(password))) {
      throw new HttpError(400, 'Credenciales inválidas');
    }

    res.json(session(user));
  })
);

/* ------------------------------------------------------------------ */
/* Email verification and password recovery                            */
/* ------------------------------------------------------------------ */

router.post(
  '/verify-email',
  codeLimiter,
  [emailRule, codeRule],
  validate,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;

    const result = await Verification.consume({
      target: email,
      purpose: 'verify_email',
      code,
      maxAttempts: env.otpMaxAttempts,
    });

    if (!result.ok) throw otpError(result, 'Código incorrecto o expirado');

    const user = await User.findOneAndUpdate(
      { email },
      { $set: { emailVerified: true } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    res.json({ verified: true, user: publicUser(user) });
  })
);

// Re-send a verification code, e.g. the first mail was lost.
router.post(
  '/resend-verification',
  codeLimiter,
  [emailRule],
  validate,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Always answer the same way. Distinguishing "no such account" here would
    // turn this endpoint into a membership oracle.
    if (!user) return res.json({ sent: true });

    const issued = await Verification.issue({
      target: email,
      channel: 'email',
      purpose: 'verify_email',
      length: env.otpLength,
      ttlMinutes: env.otpTtlMinutes,
    });

    const { delivered } = await mailService.sendMail({
      to: email,
      subject: 'Verifica tu cuenta de TAK TAK',
      text: `Tu código de verificación es ${issued.code}. Caduca en ${env.otpTtlMinutes} minutos.`,
    });

    return res.json({ sent: true, delivered, code: delivered ? undefined : devCode(issued.code) });
  })
);

// Step 1 of recovery: ask for a code.
router.post(
  '/forgot-password',
  codeLimiter,
  [emailRule],
  validate,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Same answer whether or not the account exists (see resend-verification).
    if (!user) return res.json({ sent: true });

    const issued = await Verification.issue({
      target: email,
      channel: 'email',
      purpose: 'reset_password',
      length: env.otpLength,
      ttlMinutes: env.otpTtlMinutes,
    });

    const { delivered } = await mailService.sendMail({
      to: email,
      subject: 'Recupera tu contraseña de TAK TAK',
      text: `Tu código para restablecer la contraseña es ${issued.code}. Caduca en ${env.otpTtlMinutes} minutos. Si no lo pediste, ignora este mensaje.`,
    });

    return res.json({ sent: true, delivered, code: delivered ? undefined : devCode(issued.code) });
  })
);

// Step 2 of recovery: exchange the code for a new password.
router.post(
  '/reset-password',
  authLimiter,
  [emailRule, codeRule, passwordRule],
  validate,
  asyncHandler(async (req, res) => {
    const { email, code, password } = req.body;

    const result = await Verification.consume({
      target: email,
      purpose: 'reset_password',
      code,
      maxAttempts: env.otpMaxAttempts,
    });
    if (!result.ok) throw otpError(result, 'Código incorrecto o expirado');

    const user = await User.findOne({ email });
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    user.password = password;
    await user.save();

    // Signing in right away is safe: the code proved control of the mailbox,
    // which is the same thing the password protects.
    res.json(session(user));
  })
);

/* ------------------------------------------------------------------ */
/* Phone sign-up                                                       */
/* ------------------------------------------------------------------ */

// Step 1: request a code. The account is NOT created yet — it is created on
// verification, so an unverified phone cannot squat a number.
router.post(
  '/phone/start',
  codeLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('country').optional().trim().isLength({ min: 2, max: 2 }),
    usernameRule.optional(),
    passwordRule.optional(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const phone = phoneService.normalizePhone(req.body.phone, req.body.country);

    const existing = await User.findOne({ phone });
    // If the number already has an account this is a sign-in, not a sign-up.
    if (existing?.phoneVerified) {
      return res.json({ existingAccount: true, phone: phoneService.maskPhone(phone) });
    }

    // Store the password pre-hashed. The pending record outlives the request,
    // and a plaintext password sitting in the database for ten minutes is a
    // leak waiting to happen.
    let passwordHash = null;
    if (req.body.password) {
      passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    const issued = await Verification.issue({
      target: phone,
      channel: 'sms',
      purpose: 'verify_phone',
      length: env.otpLength,
      ttlMinutes: env.otpTtlMinutes,
      payload: {
        username: req.body.username || null,
        passwordHash,
        country: phoneService.normalizeCountry(req.body.country) || null,
      },
    });

    const { delivered, reason } = await smsService.sendSms({
      to: phone,
      body: `TAK TAK: tu código es ${issued.code}. Caduca en ${env.otpTtlMinutes} minutos.`,
    });

    return res.status(201).json({
      sent: true,
      delivered,
      // Surfaced so a deployment with no SMS provider shows the user a real
      // failure instead of a "check your phone" screen for a message that will
      // never arrive.
      reason,
      // Same rule as the email flows: only when the SMS could not be sent, and
      // never in production.
      code: delivered ? undefined : devCode(issued.code),
      phone: phoneService.maskPhone(phone),
      expiresInSeconds: env.otpTtlMinutes * 60,
    });
  })
);

// Step 2: verify the code and create (or sign in to) the account.
router.post(
  '/phone/verify',
  authLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('country').optional().trim().isLength({ min: 2, max: 2 }),
    codeRule,
  ],
  validate,
  asyncHandler(async (req, res) => {
    const phone = phoneService.normalizePhone(req.body.phone, req.body.country);

    const result = await Verification.consume({
      target: phone,
      purpose: 'verify_phone',
      code: req.body.code,
      maxAttempts: env.otpMaxAttempts,
    });
    if (!result.ok) throw otpError(result, 'Código incorrecto o expirado');

    let user = await User.findOne({ phone });

    if (!user) {
      const pending = result.payload || {};
      const username = pending.username || (await generateUsername(`u${phone.slice(-6)}`));

      // A user who chose a username that got taken between step 1 and step 2
      // still gets an account, with a generated one, rather than a dead end.
      // La comprobación es la misma que la del alta por correo: insensible a
      // mayúsculas, para no crear dos cuentas que casen con el mismo @usuario.
      const taken = await User.existsByUsername(username);
      const finalUsername = taken ? await generateUsername(`u${phone.slice(-6)}`) : username;

      const digits = phone.replace(/\D/g, '');
      const email = `${digits}@phone.taktak.app`;

      try {
        // Built with `new` rather than `create` so the pre-save hook can be told
        // the password is already a digest (see the hook in models/User.js).
        user = new User({
          username: finalUsername,
          // A phone account still needs an email (it is the unique login key).
          // The placeholder is derived from the number so it cannot collide.
          email,
          password: pending.passwordHash || undefined,
          phone,
          phoneVerified: true,
          profile: { displayName: finalUsername },
          wallet: { bonusC: env.welcomeBonusCoins, ttcR: 0 },
        });
        if (pending.passwordHash) user.$locals.passwordAlreadyHashed = true;
        await user.save();
      } catch (err) {
        // Two requests verifying the same number concurrently both find no
        // user and both try to insert. The unique index rejects the loser; it
        // should then sign in to the winner's account instead of erroring.
        if (err.code === 11000) {
          user = await User.findOne({ phone });
          if (!user) throw err;
        } else {
          throw err;
        }
      }
    } else if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }

    res.json(session(user));
  })
);

/* ------------------------------------------------------------------ */
/* Link a phone to an existing account                                 */
/* ------------------------------------------------------------------ */

// These are for users who signed up with an email (or Google) and later want
// to add a phone number. That matters beyond convenience: the dialer resolves
// numbers to accounts through `phone`, so an account without one cannot be
// called by number, and TAK TAK's contacts matching has nothing to match on.
//
// The flow mirrors phone sign-up — request a code, then verify it — but it is
// authenticated: the phone is attached to the signed-in account, never used to
// create or switch one. Verifying proves control of the number, so an attacker
// cannot attach someone else's phone to their own account.
router.post(
  '/phone/link/start',
  auth,
  codeLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('country').optional().trim().isLength({ min: 2, max: 2 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const phone = phoneService.normalizePhone(req.body.phone, req.body.country);

    const owner = await User.findOne({ phone }).select('_id phoneVerified');
    if (owner && String(owner._id) !== String(req.user.userId)) {
      // Someone else already has it. The message is deliberately the same
      // whether they verified or not: telling them apart would turn this into
      // an oracle for which numbers are registered.
      throw new HttpError(409, 'Ese número ya está vinculado a otra cuenta de TAK TAK');
    }
    if (owner && String(owner._id) === String(req.user.userId) && owner.phoneVerified) {
      // Already yours and verified: nothing to do. Re-sending an SMS here would
      // spend money on a number that is already attached.
      return res.json({ alreadyLinked: true, phone: phoneService.maskPhone(phone) });
    }

    const issued = await Verification.issue({
      target: phone,
      channel: 'sms',
      purpose: 'link_phone',
      length: env.otpLength,
      ttlMinutes: env.otpTtlMinutes,
      // The account this code is for. On verify it must match the signed-in
      // user, so a code intercepted from one session cannot link the number to
      // another account.
      payload: { userId: String(req.user.userId) },
    });

    const { delivered, reason } = await smsService.sendSms({
      to: phone,
      body: `TAK TAK: tu código para vincular el teléfono es ${issued.code}. Caduca en ${env.otpTtlMinutes} minutos.`,
    });

    return res.status(201).json({
      sent: true,
      delivered,
      reason,
      code: delivered ? undefined : devCode(issued.code),
      phone: phoneService.maskPhone(phone),
      expiresInSeconds: env.otpTtlMinutes * 60,
    });
  })
);

router.post(
  '/phone/link/verify',
  auth,
  authLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('country').optional().trim().isLength({ min: 2, max: 2 }),
    codeRule,
  ],
  validate,
  asyncHandler(async (req, res) => {
    const phone = phoneService.normalizePhone(req.body.phone, req.body.country);

    const result = await Verification.consume({
      target: phone,
      purpose: 'link_phone',
      code: req.body.code,
      maxAttempts: env.otpMaxAttempts,
    });
    if (!result.ok) throw otpError(result, 'Código incorrecto o expirado');

    // The code must belong to the account asking to redeem it. Without this a
    // leaked code could attach the number to a different account.
    if (String(result.payload?.userId) !== String(req.user.userId)) {
      throw new HttpError(403, 'Este código no corresponde a tu cuenta');
    }

    const user = await User.findById(req.user.userId);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    user.phone = phone;
    user.phoneVerified = true;
    try {
      await user.save();
    } catch (err) {
      // Two accounts verifying the same number at once: the unique index lets
      // one through and rejects the other. The loser gets a clear message
      // instead of a 500.
      if (err.code === 11000) {
        throw new HttpError(409, 'Ese número ya está vinculado a otra cuenta de TAK TAK');
      }
      throw err;
    }

    res.json({ linked: true, user: publicUser(user) });
  })
);

/* ------------------------------------------------------------------ */
/* Google sign-in                                                      */
/* ------------------------------------------------------------------ */

router.post(
  '/google',
  authLimiter,
  [body('idToken').notEmpty().withMessage('Token de Google requerido')],
  validate,
  asyncHandler(async (req, res) => {
    const claims = await googleService.verifyGoogleIdToken(req.body.idToken);

    let user = await User.findOne({ googleId: claims.googleId });

    // An account may already exist with the same email. Linking them is correct
    // only when Google says the address is verified — otherwise anyone able to
    // create a Google account claiming that email could take over the account.
    if (!user && claims.email && claims.emailVerified) {
      user = await User.findOne({ email: claims.email });
      if (user && !user.googleId) {
        user.googleId = claims.googleId;
        user.emailVerified = true;
        await user.save();
      }
    }

    if (!user) {
      const base = claims.email ? claims.email.split('@')[0] : 'user';
      const username = await generateUsername(base);
      user = await User.create({
        username,
        email: claims.email || `${claims.googleId}@google.taktak.app`,
        googleId: claims.googleId,
        emailVerified: Boolean(claims.emailVerified),
        profile: { displayName: claims.name || username, avatar: claims.picture || undefined },
        wallet: { bonusC: env.welcomeBonusCoins, ttcR: 0 },
      });
    }

    res.json(session(user));
  })
);

/* ------------------------------------------------------------------ */
/* Facebook sign-in                                                    */
/* ------------------------------------------------------------------ */

// Facebook Login. El SDK del navegador entrega un token de acceso opaco, no un
// JWT: `facebookService` lo verifica contra el Graph API antes de fiarse de él.
router.post(
  '/facebook',
  authLimiter,
  [body('accessToken').notEmpty().withMessage('Token de Facebook requerido')],
  validate,
  asyncHandler(async (req, res) => {
    const claims = await facebookService.verifyFacebookAccessToken(req.body.accessToken);

    let user = await User.findOne({ facebookId: claims.facebookId });

    // Igual que con Google: enlazar con una cuenta existente del mismo correo
    // solo es correcto cuando Facebook confirma el correo. Si no, quien pudiera
    // crear una cuenta de Facebook con esa dirección tomaría la cuenta.
    if (!user && claims.email && claims.emailVerified) {
      user = await User.findOne({ email: claims.email });
      if (user && !user.facebookId) {
        user.facebookId = claims.facebookId;
        user.emailVerified = true;
        await user.save();
      }
    }

    if (!user) {
      const base = claims.email ? claims.email.split('@')[0] : 'user';
      const username = await generateUsername(base);
      user = await User.create({
        username,
        email: claims.email || `${claims.facebookId}@facebook.taktak.app`,
        facebookId: claims.facebookId,
        emailVerified: Boolean(claims.emailVerified),
        profile: { displayName: claims.name || username, avatar: claims.picture || undefined },
        wallet: { bonusC: env.welcomeBonusCoins, ttcR: 0 },
      });
    }

    res.json(session(user));
  })
);

/* ------------------------------------------------------------------ */
/* Session refresh                                                     */
/* ------------------------------------------------------------------ */

router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Token de refresco requerido')],
  validate,
  asyncHandler(async (req, res) => {
    let payload;
    try {
      payload = verifyRefreshToken(req.body.refreshToken);
    } catch {
      throw new HttpError(401, 'Token de refresco inválido o expirado');
    }

    // The user is re-read rather than trusted from the token: a deleted or
    // downgraded account must not be able to refresh its way back in.
    const user = await User.findById(payload.userId);
    if (!user) throw new HttpError(401, 'Sesión inválida');

    res.json(session(user));
  })
);

// Which optional providers this deployment has configured, so the UI can hide
// buttons that would only fail. Also serves the country list for the phone
// picker, generated from libphonenumber so every country is covered.
router.get('/providers', (req, res) => {
  res.json({
    google: googleService.isConfigured(),
    googleClientId: env.googleClientId,
    facebook: facebookService.isConfigured(),
    facebookAppId: env.facebookAppId,
    sms: smsService.isConfigured(),
    email: mailService.isConfigured(),
    // Llamadas a teléfonos que no tienen la app. El marcador lo usa para
    // ofrecer "llamar por teléfono" en vez de dejar un botón que solo fallaría.
    voice: voiceService.isConfigured(),
    countries: phoneService.listCountries(req.query.locale || 'es'),
  });
});

// Authenticated password change. Distinct from the reset flow: it requires the
// current password, because the session alone is not proof of ownership.
router.post(
  '/change-password',
  auth,
  [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    passwordRule,
  ],
  validate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId).select('+password');
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    if (!(await user.comparePassword(req.body.currentPassword))) {
      throw new HttpError(400, 'La contraseña actual no es correcta');
    }

    user.password = req.body.password;
    await user.save();

    res.json({ updated: true });
  })
);

// Maps a failed code check to a message that helps the user without telling an
// attacker how far they got. Only the attempt count is disclosed, because the
// user needs it to understand the lockout.
function otpError(result, fallback) {
  if (result.reason === 'too_many_attempts') {
    return new HttpError(429, 'Demasiados intentos con este código. Solicita uno nuevo.');
  }
  if (result.reason === 'mismatch') {
    return new HttpError(400, `${fallback}. Intentos restantes: ${result.attemptsLeft}`);
  }
  return new HttpError(400, fallback);
}

module.exports = router;
