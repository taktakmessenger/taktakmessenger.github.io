const mongoose = require('mongoose');
const crypto = require('crypto');

// One row per issued one-time code. The same collection serves email
// verification, phone verification and password reset, because the security
// requirements are identical: a short code, a hard expiry, a bounded number of
// guesses, and single use.
//
// The code is never stored in the clear. A database leak would otherwise hand
// the attacker a working reset code for every account pending verification.
const verificationSchema = new mongoose.Schema(
  {
    // What the code proves control of: an email address or an E.164 phone.
    target: { type: String, required: true, index: true },
    channel: { type: String, enum: ['email', 'sms'], required: true },
    purpose: {
      type: String,
      enum: ['verify_email', 'verify_phone', 'reset_password'],
      required: true,
    },

    // sha256(code + pepper). A slow KDF is unnecessary here: the code space is
    // tiny, but it is short-lived and attempt-limited, which is what actually
    // stops brute force. The pepper keeps a stolen dump from being reversed by
    // enumerating the 1,000,000 possible codes.
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },

    // Pending registration data for phone sign-up. The account is created only
    // after the code is verified, so an attacker cannot squat a phone number by
    // registering it first and leaving it unverified: the number's real owner
    // simply verifies and gets the account. The password stored here is already
    // hashed, never plaintext.
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Lookups are always "the live code for this target and purpose".
verificationSchema.index({ target: 1, purpose: 1, createdAt: -1 });
// Lets a TTL sweep reclaim rows. Mongo's TTL monitor runs about once a minute,
// so correctness never depends on it: `expiresAt` is checked on every read.
verificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function pepper() {
  return process.env.OTP_PEPPER || process.env.JWT_SECRET || 'dev-otp-pepper';
}

function hashCode(code) {
  return crypto.createHmac('sha256', pepper()).update(String(code)).digest('hex');
}

// `randomInt` is cryptographically secure. `Math.random` would be predictable
// from a few observed codes, which is a real attack on a 6-digit space.
verificationSchema.statics.generateCode = function generateCode(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
};

verificationSchema.statics.hashCode = hashCode;

/**
 * Issue a code for a target, invalidating any previous live code.
 *
 * Superseding the old code matters: if a user requests a new code, the earlier
 * one must stop working, otherwise every code ever sent stays valid for its
 * full lifetime and the guessing budget multiplies.
 */
verificationSchema.statics.issue = async function issue({
  target,
  channel,
  purpose,
  length = 6,
  ttlMinutes = 10,
  payload = null,
}) {
  const now = new Date();
  await this.updateMany(
    { target, purpose, consumedAt: null },
    { $set: { consumedAt: now } }
  );

  const code = this.generateCode(length);
  const doc = await this.create({
    target,
    channel,
    purpose,
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    payload,
  });

  // The plaintext code is returned once, to be delivered. It is not persisted.
  return { code, id: doc._id, expiresAt: doc.expiresAt };
};

/**
 * Check a submitted code, counting the attempt.
 *
 * Returns a result object rather than throwing, so the route can map each
 * outcome to a precise message without leaking which part failed.
 */
verificationSchema.statics.consume = async function consume({
  target,
  purpose,
  code,
  maxAttempts = 5,
}) {
  const record = await this.findOne({
    target,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) return { ok: false, reason: 'expired' };
  if (record.attempts >= maxAttempts) return { ok: false, reason: 'too_many_attempts' };

  // Compare in constant time so the response time does not reveal how many
  // leading digits were correct.
  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(code), 'hex');
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    record.attempts += 1;
    await record.save();
    return {
      ok: false,
      reason: 'mismatch',
      attemptsLeft: Math.max(0, maxAttempts - record.attempts),
    };
  }

  record.consumedAt = new Date();
  await record.save();
  return { ok: true, payload: record.payload };
};

module.exports = mongoose.model('Verification', verificationSchema);
