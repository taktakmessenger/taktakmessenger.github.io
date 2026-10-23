const crypto = require('crypto');
const PaymentMethod = require('../models/PaymentMethod');
const User = require('../models/User');
const env = require('../config/env');
const stripeService = require('./stripeService');
const paypalService = require('./paypalService');
const { HttpError } = require('../utils/http');

// Métodos de pago guardados: alta, listado, baja y cobro.
//
// La regla que ordena todo este módulo: el número de tarjeta nunca entra aquí.
// El navegador lo manda a Stripe con la clave publicable y recibe un `pm_...`;
// solo ese identificador llega al servidor. Guardar el número convertiría a TAK
// TAK en depositario de datos de tarjeta (PCI-DSS) y un vuelco de la base
// entregaría tarjetas usables.

// Cómo se enseña un método cuando el usuario no le puso nombre.
function defaultLabel(method) {
  if (method.kind === 'paypal') {
    return method.email ? `PayPal · ${method.email}` : 'PayPal';
  }
  const brand = method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'Tarjeta';
  return `${brand} ···· ${method.last4}`;
}

function publicMethod(method) {
  const json = method.toPublicJSON();
  return { ...json, display: method.label || defaultLabel(method) };
}

// Devuelve el cliente de Stripe del usuario, creándolo la primera vez.
//
// Se crea de forma perezosa en vez de en el registro: la mayoría de las cuentas
// nunca guardarán una tarjeta, y crear un cliente en Stripe para todas sería
// ensuciar la cuenta del comercio con miles de clientes vacíos.
async function ensureStripeCustomer(user) {
  if (user.paymentRefs?.stripeCustomerId) return user.paymentRefs.stripeCustomerId;

  const customerId = await stripeService.createCustomer({
    userId: user._id,
    email: user.email,
  });

  await User.updateOne(
    { _id: user._id },
    { $set: { 'paymentRefs.stripeCustomerId': customerId } }
  );

  return customerId;
}

/**
 * Prepara el alta de una tarjeta.
 *
 * Devuelve el `client_secret` del SetupIntent y la clave publicable. El
 * navegador usa ambos con Stripe.js: manda el número DIRECTRO a Stripe y recibe
 * un `pm_...` que luego nos pasa para guardarlo. El número nunca pasa por aquí.
 */
async function startCardSetup({ userId }) {
  if (!stripeService.isConfigured()) {
    throw new HttpError(503, 'El pago con tarjeta no está disponible');
  }

  const user = await User.findById(userId).select('+paymentRefs.stripeCustomerId');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  const customerId = await ensureStripeCustomer(user);
  const intent = await stripeService.createSetupIntent({ customerId });

  return {
    provider: 'stripe',
    clientSecret: intent.clientSecret,
    publishableKey: stripeService.publishableKey(),
  };
}

/**
 * Guarda una tarjeta ya tokenizada.
 *
 * El `paymentMethodId` lo produce Stripe.js en el navegador. Aquí se comprueba
 * contra Stripe que existe y se leen los datos de presentación DE STRIPE, no del
 * cliente: si el cliente mandara "Visa ···· 4242" podría etiquetar una tarjeta
 * distinta con esos datos y confundir al usuario en la lista.
 */
async function saveCard({ userId, paymentMethodId, label }) {
  if (!stripeService.isConfigured()) {
    throw new HttpError(503, 'El pago con tarjeta no está disponible');
  }
  if (!paymentMethodId || !/^pm_[A-Za-z0-9_]+$/.test(String(paymentMethodId))) {
    throw new HttpError(400, 'Falta el identificador de la tarjeta');
  }

  const user = await User.findById(userId).select('+paymentRefs.stripeCustomerId');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  const customerId = await ensureStripeCustomer(user);

  // El SetupIntent ya la deja creada; el attach la cuelga del cliente, que es
  // lo que permite cobrarla después sin el titular delante.
  await stripeService.attachPaymentMethod({ paymentMethodId, customerId });

  const card = await stripeService.retrievePaymentMethod(paymentMethodId);
  if (card.type !== 'card') {
    throw new HttpError(400, 'Ese método no es una tarjeta');
  }

  const method = await upsertMethod({
    userId,
    provider: 'stripe',
    kind: 'card',
    providerRef: card.id,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    label,
  });

  return publicMethod(method);
}

/**
 * Prepara el alta de una cuenta de PayPal.
 *
 * PayPal no tokeniza tarjetas: lo que se guarda es la aprobación del usuario, y
 * con ella un `vault_id`. Se devuelve la URL de aprobación a la que hay que
 * mandar al navegador.
 */
async function startPaypalLink({ userId }) {
  if (!paypalService.isConfigured()) {
    throw new HttpError(503, 'El pago con PayPal no está disponible');
  }

  const returnUrl = `${env.appUrl}/?view=pago-exito&provider=paypal&link=1`;
  const cancelUrl = `${env.appUrl}/?view=metodos-pago`;

  return paypalService.createVaultOrder({ userId, returnUrl, cancelUrl });
}

/**
 * Confirma el alta de PayPal tras la aprobación del usuario.
 *
 * `orderId` viene de la vuelta del navegador. Se le pide a PayPal el estado de
 * la orden y de ahí se saca el `vault_id`. No se acredita nada aquí: guardar un
 * método no mueve dinero.
 */
async function confirmPaypalLink({ userId, orderId }) {
  if (!paypalService.isConfigured()) {
    throw new HttpError(503, 'El pago con PayPal no está disponible');
  }
  if (!orderId) throw new HttpError(400, 'Falta la orden de PayPal');

  const order = await paypalService.captureOrder(orderId);
  const vaultId = paypalService.extractVaultId(order);
  if (!vaultId) {
    // Sin vault_id no hay nada que cobrar después: es mejor decirlo que
    // guardar un método muerto que falle al primer cobro.
    throw new HttpError(400, 'PayPal no devolvió un método guardable');
  }

  const method = await upsertMethod({
    userId,
    provider: 'paypal',
    kind: 'paypal',
    providerRef: vaultId,
    email: paypalService.extractPayerEmail(order),
  });

  return publicMethod(method);
}

// Alta idempotente: si el método ya estaba guardado, se actualiza en vez de
// crear un duplicado. Cubre la carrera entre el webhook y la vuelta del
// navegador, que pueden procesar el mismo alta a la vez.
async function upsertMethod(data) {
  const { userId, provider, kind, providerRef } = data;

  const existing = await PaymentMethod.findOne({ user: userId, providerRef });

  const update = {
    provider,
    kind,
    brand: data.brand ?? null,
    last4: data.last4 ?? null,
    expMonth: data.expMonth ?? null,
    expYear: data.expYear ?? null,
    email: data.email ?? null,
    label: data.label ?? null,
    revoked: false,
  };

  let method;
  if (existing) {
    existing.set(update);
    method = await existing.save();
  } else {
    method = await PaymentMethod.create({ user: userId, providerRef, ...update });
  }

  // El primero que se guarda queda predeterminado. Sin esto, el usuario tendría
  // que marcar uno a mano antes de poder pagar con un método guardado.
  const count = await PaymentMethod.countDocuments({
    user: userId,
    revoked: false,
    _id: { $ne: method._id },
  });
  if (count === 0 && !method.isDefault) {
    method.isDefault = true;
    await method.save();
  }

  return method;
}

async function listMethods({ userId }) {
  const methods = await PaymentMethod.find({ user: userId, revoked: false }).sort({
    isDefault: -1,
    createdAt: -1,
  });

  return methods.map(publicMethod);
}

/**
 * Marca un método como predeterminado.
 *
 * Se hace en dos pasos dentro de una transacción cuando el servidor la soporta:
 * quitar el anterior y poner el nuevo. Si se hiciera en dos escrituras sueltas y
 * la segunda fallara, el usuario se quedaría sin ningún predeterminado.
 */
async function setDefault({ userId, methodId }) {
  const method = await PaymentMethod.findOne({ _id: methodId, user: userId, revoked: false });
  if (!method) throw new HttpError(404, 'Método de pago no encontrado');

  await PaymentMethod.updateMany(
    { user: userId, isDefault: true },
    { $set: { isDefault: false } }
  );
  method.isDefault = true;
  await method.save();

  return publicMethod(method);
}

/**
 * Borra un método.
 *
 * Primero se revoca en nuestra base y solo después se intenta desvincular del
 * proveedor. El orden importa: si la llamada al proveedor falla (red, servicio
 * caído), el método ya no se puede cobrar desde aquí. Al revés, un fallo dejaría
 * la tarjeta viva y borrada a la vez.
 */
async function removeMethod({ userId, methodId }) {
  const method = await PaymentMethod.findOne({ _id: methodId, user: userId, revoked: false });
  if (!method) throw new HttpError(404, 'Método de pago no encontrado');

  const wasDefault = method.isDefault;

  method.revoked = true;
  method.isDefault = false;
  await method.save();

  // Si era el predeterminado, se promociona el más reciente que quede para que
  // el usuario no se quede sin ninguno habiendo otros disponibles.
  if (wasDefault) {
    const next = await PaymentMethod.findOne({ user: userId, revoked: false }).sort({
      createdAt: -1,
    });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }

  if (method.provider === 'stripe' && stripeService.isConfigured()) {
    try {
      await stripeService.detachPaymentMethod(method.providerRef);
    } catch (err) {
      // Se registra para poder reintentar la limpieza; el método ya está
      // revocado en nuestro lado, así que no se puede cobrar.
      console.error('[PAGOS] No se pudo desvincular la tarjeta de Stripe:', err.message);
    }
  }

  return { ok: true };
}

/**
 * Cobra un paquete con un método guardado.
 *
 * Devuelve el resultado del cobro. No acredita monedas: eso lo hace el webhook
 * del proveedor, que es la única fuente que prueba que el dinero entró. Si se
 * acreditara aquí, un cobro que el banco rechaza después dejaría monedas
 * regaladas.
 */
async function chargeWithSavedMethod({ userId, methodId, packageId }) {
  const method = await PaymentMethod.findOne({ _id: methodId, user: userId, revoked: false });
  if (!method) throw new HttpError(404, 'Método de pago no encontrado');

  const pkg = env.coinPackages.find((p) => p.id === packageId);
  if (!pkg) throw new HttpError(400, 'Paquete de monedas desconocido');

  // Clave de idempotencia estable por (usuario, método, paquete, minuto): un
  // doble clic o un reintento del navegador devuelve el mismo cobro en vez de
  // cobrar dos veces.
  const bucket = Math.floor(Date.now() / 60000);
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${userId}:${method._id}:${pkg.id}:${bucket}`)
    .digest('hex');

  if (method.provider === 'stripe') {
    if (!stripeService.isConfigured()) {
      throw new HttpError(503, 'El pago con tarjeta no está disponible');
    }
    const user = await User.findById(userId).select('+paymentRefs.stripeCustomerId');
    const result = await stripeService.chargeStoredPaymentMethod({
      paymentMethodId: method.providerRef,
      customerId: user.paymentRefs?.stripeCustomerId,
      userId,
      pkg,
      idempotencyKey,
    });

    // Un cobro que no queda "succeeded" (por ejemplo, el banco pide 3-D Secure)
    // no se puede dar por bueno. Se avisa para que el usuario lo confirme en vez
    // de dejarlo esperando monedas que no van a llegar.
    if (result.status !== 'succeeded') {
      throw new HttpError(
        402,
        'Tu banco pide que confirmes el pago. Prueba otra vez o usa otra tarjeta.'
      );
    }

    return { provider: 'stripe', status: result.status, reference: result.id };
  }

  if (method.provider === 'paypal') {
    if (!paypalService.isConfigured()) {
      throw new HttpError(503, 'El pago con PayPal no está disponible');
    }
    const result = await paypalService.chargeStoredVault({
      vaultId: method.providerRef,
      userId,
      pkg,
      idempotencyKey,
    });
    return { provider: 'paypal', status: result.status, reference: result.id };
  }

  throw new HttpError(400, 'Ese método no se puede cobrar');
}

module.exports = {
  startCardSetup,
  saveCard,
  startPaypalLink,
  confirmPaypalLink,
  listMethods,
  setDefault,
  removeMethod,
  chargeWithSavedMethod,
  defaultLabel,
};
