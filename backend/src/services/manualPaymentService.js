const ManualOrder = require('../models/ManualOrder');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const paymentService = require('./paymentService');
const assistant = require('./manualPaymentAssistant');
const { HttpError } = require('../utils/http');

// Cobro manual: el usuario paga por fuera de la app y un administrador aprueba.
//
// La parte delicada no es cobrar, es abonar. El abono NO se hace aquí a mano:
// pasa por `paymentService.creditPurchase`, la misma puerta que usan Stripe y
// PayPal. Así el precio sale del catálogo del servidor y el `externalId` único
// hace que aprobar dos veces la misma orden (o un reintento tras un corte) no
// acredite monedas dos veces. Duplicar esa lógica aquí sería la forma más fácil
// de regalar saldo.

function listMethods() {
  return env.manualPaymentMethods;
}

function findMethod(methodId) {
  const method = env.manualPaymentMethods.find((m) => m.id === methodId);
  if (!method) throw new HttpError(400, 'Método de pago no disponible');
  return method;
}

/**
 * Crea una orden pendiente. No acredita nada: eso ocurre al aprobarla.
 *
 * El precio y las monedas se copian del catálogo en este momento y quedan
 * congelados en la orden, para que lo que el usuario ve al pagar sea lo que se
 * le acredita al aprobar.
 */
async function createOrder({ userId, packageId, methodId, reference, note }) {
  if (!env.manualPaymentMethods.length) {
    throw new HttpError(503, 'El cobro manual no está configurado');
  }
  const method = findMethod(methodId);
  const pkg = paymentService.findPackage(packageId);

  return ManualOrder.create({
    user: userId,
    packageId: pkg.id,
    coins: pkg.coins,
    priceUsd: pkg.priceUsd,
    method: method.id,
    reference,
    note,
  });
}

// Órdenes de un usuario, para que vea en qué va la suya.
async function listUserOrders({ userId }) {
  return ManualOrder.find({ user: userId }).sort({ createdAt: -1 }).limit(50);
}

// Cola del administrador: pendientes primero, la más reciente arriba.
async function listOrders({ status } = {}) {
  const filter = status ? { status } : {};
  return ManualOrder.find(filter).sort({ createdAt: -1 }).limit(100).populate('user', 'username email');
}

// Cuántas órdenes comparten una misma referencia. Una referencia repetida es la
// señal de abuso más barata de detectar: alguien pagando una vez y enviando el
// mismo comprobante para varios paquetes.
async function referenceReuse(reference) {
  if (!reference) return 0;
  return ManualOrder.countDocuments({ reference });
}

/**
 * Revisa las órdenes pendientes con el asistente.
 *
 * Devuelve una propuesta por orden. No toca ninguna orden: solo lee y sugiere,
 * así que se puede llamar tantas veces como haga falta sin consecuencia. Si el
 * asistente no está configurado, devuelve una lista vacía y el panel sigue
 * funcionando a mano.
 */
async function reviewPending({ limit = 20 } = {}) {
  if (!assistant.isConfigured()) {
    return { configured: false, reviewed: [] };
  }

  const orders = await ManualOrder.find({ status: 'pending' })
    .sort({ createdAt: -1 })
    .limit(limit);

  const reviewed = [];
  for (const order of orders) {
    const sameReferenceCount = await referenceReuse(order.reference);
    const suggestion = await assistant.suggest(order, { sameReferenceCount });
    reviewed.push({
      orderId: order._id,
      suggestion,
      autoApprovable: assistant.isAutoApprovable({
        suggestion,
        priceUsd: order.priceUsd,
        sameReferenceCount,
      }),
    });
  }

  return { configured: true, reviewed };
}

/**
 * Aprobación automática: aplica el asistente a las pendientes y aprueba las que
 * pasan el filtro. Devuelve cuántas aprobó.
 *
 * Va detrás de `MANUAL_AUTO_APPROVE`; sin esa bandera no aprueba nada. Es la
 * única ruta que mueve dinero sin una persona, y por eso solo la llama el cron
 * cuando el operador la enciende a conciencia.
 */
async function autoApprovePending({ limit = 20 } = {}) {
  if (!env.manualAutoApprove || !assistant.isConfigured()) {
    return { approved: 0, skipped: 0 };
  }

  const orders = await ManualOrder.find({ status: 'pending' })
    .sort({ createdAt: 'asc' })
    .limit(limit);

  let approved = 0;
  let skipped = 0;

  for (const order of orders) {
    const sameReferenceCount = await referenceReuse(order.reference);
    const suggestion = await assistant.suggest(order, { sameReferenceCount });

    if (
      !assistant.isAutoApprovable({
        suggestion,
        priceUsd: order.priceUsd,
        sameReferenceCount,
      })
    ) {
      skipped += 1;
      continue;
    }

    try {
      await approveOrder({ orderId: order._id, adminId: null, auto: true });
      approved += 1;
    } catch (error) {
      // Una orden que falla no debe cortar el lote: se deja pendiente y sigue.
      console.warn(`[ASISTENTE] No se pudo aprobar ${order._id}: ${error.message}`);
      skipped += 1;
    }
  }

  return { approved, skipped };
}

/**
 * Aprueba una orden y acredita las monedas.
 *
 * El abono va primero y es idempotente (el `externalId` `manual_<orden>` choca
 * con el índice único si se repite). Solo después se marca la orden como
 * aprobada: si el proceso se corta entre las dos cosas, la orden sigue
 * pendiente y volver a aprobarla no paga dos veces, porque el abono ya está.
 */
async function approveOrder({ orderId, adminId, auto = false }) {
  const order = await ManualOrder.findById(orderId);
  if (!order) throw new HttpError(404, 'Orden no encontrada');
  if (order.status !== 'pending') {
    throw new HttpError(409, 'La orden ya fue revisada');
  }

  const result = await paymentService.creditPurchase({
    externalId: `manual_${order._id}`,
    userId: order.user,
    packageId: order.packageId,
    provider: 'manual',
  });

  const transaction =
    result.transactionId ||
    (await Transaction.findOne({ externalId: `manual_${order._id}` }))?._id;

  const updated = await ManualOrder.findByIdAndUpdate(
    order._id,
    {
      status: 'approved',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      // Queda registrado si aprobó una persona o el asistente, para poder
      // auditar después por qué se acreditó cada orden.
      reviewNote: auto ? 'Aprobada automáticamente por el asistente' : undefined,
      transaction,
    },
    { new: true }
  );

  return { order: updated, credited: result.credited, coins: result.coins };
}

async function rejectOrder({ orderId, adminId, reason }) {
  const order = await ManualOrder.findById(orderId);
  if (!order) throw new HttpError(404, 'Orden no encontrada');
  if (order.status !== 'pending') {
    throw new HttpError(409, 'La orden ya fue revisada');
  }

  return ManualOrder.findByIdAndUpdate(
    order._id,
    {
      status: 'rejected',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: reason || '',
    },
    { new: true }
  );
}

module.exports = {
  listMethods,
  findMethod,
  createOrder,
  listUserOrders,
  listOrders,
  reviewPending,
  autoApprovePending,
  approveOrder,
  rejectOrder,
};
