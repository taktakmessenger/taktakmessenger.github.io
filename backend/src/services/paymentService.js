const User = require('../models/User');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const stripeService = require('./stripeService');
const paypalService = require('./paypalService');
const { HttpError } = require('../utils/http');

// Cobro de monedas y abono de saldo.
//
// Todo lo que acredita monedas pasa por `creditPurchase`. Es una sola puerta a
// propósito: el abono tiene que ser idempotente y comprobar el precio, y esas
// dos reglas no pueden vivir repartidas por cada proveedor, o la primera que se
// olvide es la que regala monedas.

// Qué pasarelas están disponibles. El cliente lo consulta para pintar solo los
// botones que van a funcionar: ofrecer "Pagar con tarjeta" cuando no hay claves
// es prometer un cobro que no existe.
function availableProviders() {
  return {
    stripe: stripeService.isConfigured(),
    paypal: paypalService.isConfigured(),
  };
}

function assertProviders() {
  const providers = availableProviders();
  if (!providers.stripe && !providers.paypal) {
    throw new HttpError(
      503,
      'Los pagos no están configurados todavía. Inténtalo más tarde.'
    );
  }
  return providers;
}

function findPackage(packageId) {
  const pkg = env.coinPackages.find((p) => p.id === packageId);
  if (!pkg) throw new HttpError(400, 'Paquete de monedas desconocido');
  return pkg;
}

// Resuelve el paquete a partir de lo que diga el proveedor, y de paso cuadra el
// importe con el catálogo.
//
// Stripe manda el id del paquete en el metadata; PayPal solo manda el importe,
// así que ahí se busca por precio. Las dos vías terminan en la misma
// comprobación: lo cobrado tiene que ser exactamente el precio del paquete. Sin
// ella, un evento que dijera "pagó 1 dólar por 7000 monedas" se acreditaría
// aunque viniera firmado por el proveedor.
function resolvePackage({ packageId, amountPaidMinor }) {
  let pkg;

  if (packageId) {
    pkg = findPackage(packageId);
  } else if (Number.isFinite(amountPaidMinor)) {
    pkg = env.coinPackages.find(
      (p) => stripeService.toMinorUnits(p.priceUsd) === amountPaidMinor
    );
    if (!pkg) throw new HttpError(400, 'Ningún paquete coincide con el importe pagado');
  } else {
    throw new HttpError(400, 'El pago no indica a qué paquete corresponde');
  }

  if (Number.isFinite(amountPaidMinor)) {
    const expected = stripeService.toMinorUnits(pkg.priceUsd);
    if (amountPaidMinor !== expected) {
      console.error(
        `[PAGOS] Importe no coincide: cobrado ${amountPaidMinor}, esperado ${expected} (${pkg.id})`
      );
      throw new HttpError(400, 'El importe del pago no coincide con el paquete');
    }
  }

  return pkg;
}

/**
 * Inicia un pago y devuelve la URL a la que mandar al usuario.
 *
 * No acredita nada: eso pasa cuando el proveedor confirma por webhook. Volver a
 * la URL de éxito no prueba que se haya cobrado, porque esa URL la puede abrir
 * cualquiera.
 */
async function startCheckout({ provider, userId, packageId }) {
  const providers = assertProviders();
  if (!providers[provider]) {
    throw new HttpError(503, `El pago con ${provider} no está disponible`);
  }

  const pkg = findPackage(packageId);
  const successUrl = `${env.appUrl}/?view=pago-exito&provider=${provider}`;
  const cancelUrl = `${env.appUrl}/?view=wallet`;

  if (provider === 'stripe') {
    return stripeService.createCheckoutSession({ userId, pkg, successUrl, cancelUrl });
  }

  if (provider === 'paypal') {
    return paypalService.createOrder({
      userId,
      pkg,
      returnUrl: successUrl,
      cancelUrl,
    });
  }

  throw new HttpError(400, 'Proveedor de pago desconocido');
}

/**
 * Acredita una compra pagada. Idempotente por `externalId`.
 *
 * Dos comprobaciones antes de tocar el saldo, y las dos importan:
 *
 *  - El importe cobrado tiene que coincidir con el precio del paquete. Si no,
 *    se rechaza: un evento que dice "pagó 1 dólar por 7000 monedas" no se
 *    acredita, aunque venga firmado por el proveedor.
 *  - El `externalId` es único en la base. Un webhook reenviado (los proveedores
 *    reintentan) encuentra la transacción ya creada y no vuelve a acreditar.
 *
 * Devuelve `{ credited, coins, duplicate }`.
 */
async function creditPurchase({ externalId, userId, packageId, amountPaidMinor, currency, provider, orderId }) {
  const pkg = resolvePackage({ packageId, amountPaidMinor });

  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  // Crea la transacción primero: su índice único sobre `externalId` es el
  // candado. Si otra entrega del mismo evento se adelantó, esta falla aquí y no
  // se llega a tocar el saldo.
  let transaction;
  try {
    transaction = await Transaction.create({
      from: user._id,
      amount: pkg.coins,
      type: 'purchase',
      ttcType: 'ttcC',
      packageId: pkg.id,
      externalId,
      amountPaid: amountPaidMinor != null ? amountPaidMinor / 100 : pkg.priceUsd,
      currency: currency || 'USD',
      method: provider,
      details: orderId ? `Orden ${orderId}` : undefined,
      status: 'completed',
    });
  } catch (err) {
    if (err.code === 11000) {
      // Ya se procesó este evento. No es un error: el proveedor reintentó.
      return { credited: false, duplicate: true, coins: 0 };
    }
    throw err;
  }

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { 'wallet.ttcC': pkg.coins } },
    { new: true }
  );

  return {
    credited: true,
    duplicate: false,
    coins: pkg.coins,
    balance: updated.wallet.ttcC,
    transactionId: transaction._id,
  };
}

// Comprueba que lo que llegó del proveedor corresponde a un paquete conocido y
// a un importe correcto, sin acreditar nada. Útil para el webhook de PayPal, que
// no manda el paquete: se resuelve por el precio.
function resolvePackageFromPayment({ packageId, amountPaidMinor }) {
  if (packageId) return findPackage(packageId);
  if (!Number.isFinite(amountPaidMinor)) {
    throw new HttpError(400, 'El pago no indica a qué paquete corresponde');
  }
  const pkg = env.coinPackages.find(
    (p) => stripeService.toMinorUnits(p.priceUsd) === amountPaidMinor
  );
  if (!pkg) throw new HttpError(400, 'Ningún paquete coincide con el importe pagado');
  return pkg;
}

module.exports = {
  availableProviders,
  startCheckout,
  creditPurchase,
  resolvePackage,
  findPackage,
};
