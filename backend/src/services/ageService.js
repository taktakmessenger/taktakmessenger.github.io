const User = require('../models/User');
const env = require('../config/env');
const { HttpError } = require('../utils/http');

// Age verification is the gate in front of adult content. It is written against
// a provider interface rather than a concrete vendor, because the sensitive
// part (ID document + selfie/liveness) belongs to a specialised service, not to
// this codebase: we must never receive or store the document itself.
//
// A provider is an object with `name` and
//   start({ userId })          -> { ref, redirectUrl? }   opens a session
//   poll({ userId, ref })      -> { status, method? }     reads the verdict
//
// The verdict is one of 'pending' | 'verified' | 'rejected'.
//
// There is deliberately **no** built-in provider that trusts the client. A
// "provider" that accepted a client-declared age would be a bypass dressed up
// as an integration, and it would be selected in production by accident the
// first time the real one failed to configure.

/**
 * Development provider.
 *
 * It exists so the flow is exercisable end to end without vendor credentials.
 * It never claims to verify anything on its own: `poll` returns 'pending'
 * forever unless an explicit decision was recorded, which only tests and an
 * admin can do. Crucially, `env.isProduction` refuses to select it (see
 * `resolveProvider`), so it cannot become the production gate by omission.
 */
const devProvider = {
  name: 'dev',
  async start({ userId }) {
    return { ref: `dev-${userId}-${Date.now()}` };
  },
  async poll() {
    // No decision has been made by a human or a vendor: still pending.
    return { status: 'pending' };
  },
};

// The registry. Adding a vendor means adding one entry here and its credentials
// to `env`; nothing else in the codebase changes.
const PROVIDERS = {
  dev: devProvider,
};

function resolveProvider() {
  const requested = env.ageProvider;

  if (!requested) {
    if (env.isProduction) {
      // Failing closed is the whole point: an unconfigured age gate must block
      // adult content, not wave it through.
      throw new HttpError(
        503,
        'La verificación de edad no está configurada en este servidor'
      );
    }
    return devProvider;
  }

  const provider = PROVIDERS[requested];
  if (!provider) {
    throw new HttpError(503, `Proveedor de verificación de edad desconocido: ${requested}`);
  }
  // The dev provider must never be the production gate, even if someone sets
  // AGE_PROVIDER=dev on a live server.
  if (env.isProduction && provider === devProvider) {
    throw new HttpError(
      503,
      'El proveedor de desarrollo no puede usarse en producción'
    );
  }
  return provider;
}

/**
 * Open a verification session for a user.
 *
 * Moves the account to `pending`. It does not touch `verified`: only a
 * confirmed verdict from the provider does that.
 */
async function startVerification(userId) {
  const provider = resolveProvider();
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  if (user.ageVerification?.status === 'verified') {
    return { status: 'verified', alreadyVerified: true };
  }

  const { ref, redirectUrl } = await provider.start({ userId: String(userId) });

  user.ageVerification = {
    ...(user.ageVerification || {}),
    status: 'pending',
    method: user.ageVerification?.method ?? null,
    providerRef: ref,
  };
  await user.save();

  return { status: 'pending', redirectUrl: redirectUrl || null, provider: provider.name };
}

/**
 * Refresh the verdict from the provider and persist it.
 *
 * Called when the client polls after returning from the provider's flow. The
 * status only ever moves to a terminal value on the provider's word, so a
 * client cannot self-approve by calling this endpoint repeatedly.
 */
async function refreshVerification(userId) {
  const provider = resolveProvider();
  const user = await User.findById(userId).select('+ageVerification.providerRef');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  if (user.ageVerification?.status === 'verified') {
    return { status: 'verified' };
  }

  const ref = user.ageVerification?.providerRef;
  if (!ref) throw new HttpError(400, 'No hay una verificación en curso');

  const verdict = await provider.poll({ userId: String(userId), ref });
  const status = ['pending', 'verified', 'rejected'].includes(verdict.status)
    ? verdict.status
    : 'pending';

  user.ageVerification.status = status;
  if (status === 'verified') {
    user.ageVerification.verifiedAt = new Date();
    user.ageVerification.method = verdict.method || 'document';
  }
  await user.save();

  return { status };
}

/**
 * Record an administrator's decision, e.g. after reviewing an appeal.
 *
 * Kept separate from the provider flow because a manual override is a different
 * trust path: it must be attributable, which is why `method` is forced to
 * 'admin' rather than taken from the request.
 */
async function setVerificationByAdmin(userId, status, adminId) {
  if (!['verified', 'rejected', 'unverified'].includes(status)) {
    throw new HttpError(400, 'Estado de verificación inválido');
  }

  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  user.ageVerification = {
    status,
    method: status === 'verified' ? 'admin' : null,
    verifiedAt: status === 'verified' ? new Date() : null,
    providerRef: null,
  };
  await user.save();

  return {
    userId: user._id,
    status: user.ageVerification.status,
    reviewedBy: adminId,
  };
}

module.exports = {
  startVerification,
  refreshVerification,
  setVerificationByAdmin,
  resolveProvider,
};
