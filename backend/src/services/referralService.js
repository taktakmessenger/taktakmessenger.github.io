// Programa de referidos: quien invita cobra cuando su invitado compra monedas.
//
// La regla de negocio en una frase: el invitador recibe el 10% de lo que el
// invitado pagó, en monedas de regalo (se gastan en la app, no se retiran).
//
// Tres decisiones que importan y por qué:
//
//  1. Se paga sobre lo COMPRADO (dinero real), no sobre las monedas entregadas.
//     Es un porcentaje de un ingreso que ya entró, así que el programa sale de
//     margen y no crea deuda. Si se pagara sobre las monedas, con paquetes que
//     regalan más monedas por dólar el premio podría superar lo cobrado.
//
//  2. Se paga en monedas de REGALO (`bonusC`). Son gastables pero no canjeables:
//     un invitador no puede convertir el premio en dinero. Si se pagara en
//     monedas pagadas, invitar a cuentas que compren sería una máquina de
//     fabricar saldo retirable, y el NAV de la empresa caería con cada premio.
//
//  3. El pago es idempotente por compra. La compra ya es idempotente por su
//     `externalId` (índice único en `Transaction`), así que un webhook
//     reenviado no vuelve a acreditar monedas ni a pagar el premio: se usa el
//     mismo `externalId` para el asiento del referido, y su índice único
//     rechaza el segundo intento.

const crypto = require('crypto');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const { HttpError } = require('../utils/http');

// Alfabeto del código sin caracteres que se confunden al dictarlos por teléfono
// o al copiarlos a mano: sin O/0, sin I/1/L, sin S/5, sin B/8.
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ234679';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function randomCode(length) {
  const size = Math.max(6, Math.min(Number(length) || 8, 16));
  let out = '';
  // `randomInt` es criptográficamente seguro: un código adivinable permitiría a
  // cualquiera robar los invitados de otro. Aunque el código no es un secreto
  // para el invitado, sí lo es frente a quien quiera suplantar a un invitador.
  for (let i = 0; i < size; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Crea (si hace falta) y devuelve el código de invitación de un usuario.
 *
 * El código se genera en la primera visita a la pantalla, no al registrarse:
 * así solo se gasta un código en las cuentas que de verdad invitan. Se reintenta
 * ante una colisión del índice único, que con 28^8 combinaciones es raro pero no
 * imposible.
 */
async function ensureCode(userId) {
  const user = await User.findById(userId).select('referral');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  if (user.referral?.code) return user.referral.code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode(env.referral.codeLength);
    try {
      const updated = await User.findOneAndUpdate(
        { _id: userId, $or: [{ 'referral.code': { $exists: false } }, { 'referral.code': null }] },
        { $set: { 'referral.code': code } },
        { new: true }
      );
      if (updated?.referral?.code) return updated.referral.code;
      // Otro proceso lo creó a la vez: se devuelve el suyo.
      const current = await User.findById(userId).select('referral');
      if (current?.referral?.code) return current.referral.code;
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Código ya tomado por otra cuenta: se prueba otro.
    }
  }
  throw new HttpError(500, 'No se pudo generar el código de invitación');
}

/**
 * Apunta quién invitó a una cuenta nueva. Se llama al registrarse.
 *
 * Devuelve el invitador o `null`. Nunca lanza: un código inválido no puede
 * tumbar el alta de un usuario que ya se ha creado. Se ignoran los casos que
 * abrirían un agujero:
 *
 *  - Código propio o de una cuenta que no existe.
 *  - Auto-referido (invitarse a uno mismo), que fabricaría premios de la nada.
 *
 * `referredBy` se escribe una sola vez: si la cuenta ya lo tenía, no se cambia.
 */
async function attachReferrer({ userId, code }) {
  try {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return null;

    const referrer = await User.findOne({ 'referral.code': clean }).select('_id referral');
    if (!referrer) return null;
    if (String(referrer._id) === String(userId)) return null;

    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [{ 'referral.referredBy': null }, { 'referral.referredBy': { $exists: false } }],
      },
      { $set: { 'referral.referredBy': referrer._id, 'referral.referredAt': new Date() } },
      { new: true }
    );
    if (!updated) return null;
    return { id: String(referrer._id), code: referrer.referral?.code || null };
  } catch (err) {
    console.error('[REFERIDOS] No se pudo apuntar al invitador:', err.message);
    return null;
  }
}

/**
 * Paga al invitador su parte de una compra del invitado.
 *
 * `amountPaidMinor` es lo que el invitado pagó, en unidades menores (céntimos).
 * El premio es `percent` de eso, redondeado a la baja para no pagar fracciones
 * de moneda ni pasarse del porcentaje. Se abona en monedas de regalo.
 *
 * Idempotente: el asiento usa `referral_<externalId>`, y el índice único de
 * `externalId` en `Transaction` hace que un segundo intento por el mismo pago
 * choque y no vuelva a pagar. Es la misma garantía que protege el abono de la
 * compra, así que los dos van juntos o no va ninguno.
 *
 * Devuelve `{ paid, amount, referrerId }` o `null` si no había nada que pagar.
 */
async function payForPurchase({ buyerId, externalId, amountPaidMinor, currency, packageId }) {
  try {
    if (!(env.referral.percent > 0)) return null;
    if (!Number.isFinite(amountPaidMinor) || amountPaidMinor <= 0) return null;
    if (!externalId) return null;

    const buyer = await User.findById(buyerId).select('referral');
    const referrerId = buyer?.referral?.referredBy;
    if (!referrerId) return null;

    // En céntimos para no arrastrar errores de coma flotante; se pasa a monedas
    // al final. `Math.floor` es deliberado: nunca se paga más del porcentaje.
    const bonus = Math.floor(amountPaidMinor * env.referral.percent) / 100;
    if (bonus <= 0) return null;

    // El asiento se crea primero: su índice único sobre `externalId` es el
    // candado. Si ya existe, otra entrega del mismo pago ya pagó el premio.
    let entry;
    try {
      entry = await Transaction.create({
        from: referrerId,
        to: buyerId,
        amount: bonus,
        type: 'referral_bonus',
        ttcType: 'ttcC',
        packageId,
        amountPaid: amountPaidMinor / 100,
        currency: currency || 'USD',
        externalId: `referral_${externalId}`,
        method: 'referral',
        details: `Premio por invitar (${Math.round(env.referral.percent * 100)}% de la compra)`,
        status: 'completed',
      });
    } catch (err) {
      if (err.code === 11000) return null;
      throw err;
    }

    // El premio es de regalo: va a `bonusC`, no a `ttcC`. Es lo que impide
    // convertirlo en dinero retirable.
    await User.updateOne(
      { _id: referrerId },
      { $inc: { 'wallet.bonusC': bonus, 'referral.earnedByReferrer': bonus } }
    );
    await User.updateOne({ _id: buyerId }, { $inc: { 'referral.earnedForReferrer': bonus } });

    // Aviso al invitador. Es un extra: si falla, el premio ya está pagado.
    try {
      const notificationService = require('./notificationService');
      await notificationService.notify({
        recipientId: referrerId,
        actorId: buyerId,
        type: 'referral',
        amount: bonus,
      });
    } catch {
      // Ignorado a propósito.
    }

    return { paid: true, amount: bonus, referrerId: String(referrerId), transactionId: entry._id };
  } catch (err) {
    console.error('[REFERIDOS] No se pudo pagar el premio:', err.message);
    return null;
  }
}

/**
 * Resumen del programa para la pantalla del usuario: su código, su enlace, a
 * cuántos ha traído y cuánto ha ganado.
 */
async function stats(userId) {
  const user = await User.findById(userId).select('referral');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  const code = user.referral?.code || null;
  const invited = await User.countDocuments({ 'referral.referredBy': userId });
  const earned = round2(user.referral?.earnedByReferrer || 0);

  return {
    code,
    link: code ? `${env.appUrl}/?ref=${code}` : null,
    percent: env.referral.percent,
    invited,
    earned,
    // Se recuerda que el premio es gastable y no retirable, para que la pantalla
    // pueda explicarlo sin duplicar la regla.
    withdrawable: false,
  };
}

module.exports = {
  ensureCode,
  attachReferrer,
  payForPurchase,
  stats,
  CODE_ALPHABET,
};
