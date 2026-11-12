const ManualOrder = require('../models/ManualOrder');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const paymentService = require('./paymentService');
const vaultService = require('./vaultService');
const assistant = require('./manualPaymentAssistant');
const { HttpError } = require('../utils/http');

// Cobro manual: el usuario paga por fuera de la app y un administrador aprueba.
//
// La parte delicada no es cobrar, es abonar. El abono NO se hace aquí a mano:
// pasa por `paymentService.creditPurchase`, la misma puerta que usa Stripe.
// Así el precio sale del catálogo del servidor y el `externalId` único
// hace que aprobar dos veces la misma orden (o un reintento tras un corte) no
// acredite monedas dos veces. Duplicar esa lógica aquí sería la forma más fácil
// de regalar saldo.

function listMethods() {
  // Los métodos manuales los declara el operador en `MANUAL_PAYMENT_METHODS`:
  // si aparecen en la lista es porque se aceptan. No dependen de ninguna
  // pasarela automática: el cobro manual se aprueba a mano, así que se ofrece
  // siempre que esté declarado.
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

// Cola del administrador. Con filtros, porque el panel y el asistente necesitan
// recortar por estado, método, usuario o fecha en vez de tragarse todo: una vez
// hay ventas reales, "dame todas las órdenes" deja de ser una consulta útil.
//
// `from`/`to` son fechas ISO y se aplican sobre `createdAt`, que es lo que el
// administrador tiene en la cabeza cuando dice "las compras de ayer".
async function listOrders({ status, method, userId, from, to, limit = 100 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (method) filter.method = method;
  if (userId) filter.user = userId;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  return ManualOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 500))
    .populate('user', 'username email');
}

/**
 * Resumen de compras para el asistente: cuánto se vendió, cuántas órdenes y
 * quiénes compraron, con el mismo filtro de fechas que `listOrders`.
 *
 * Va por agregación y no sumando en JS porque el asistente debe poder responder
 * "cuánto se vendió este mes" sin traerse todas las órdenes a memoria.
 */
async function purchaseSummary({ status, from, to } = {}) {
  const match = {};
  if (status) match.status = status;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }

  const [totals] = await ManualOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        ordenes: { $sum: 1 },
        monedas: { $sum: '$coins' },
        usd: { $sum: '$priceUsd' },
      },
    },
  ]);

  // Desglose por estado. Sin esto, el panel sumaba en "Total cobrado" las
  // órdenes pendientes y las rechazadas, que no son dinero que haya entrado.
  const byStatus = await ManualOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        ordenes: { $sum: 1 },
        monedas: { $sum: '$coins' },
        usd: { $sum: '$priceUsd' },
      },
    },
  ]);

  const statusTotals = { approved: 0, pending: 0, rejected: 0 };
  const statusCounts = { approved: 0, pending: 0, rejected: 0 };
  const statusCoins = { approved: 0, pending: 0, rejected: 0 };
  for (const row of byStatus) {
    if (statusTotals[row._id] === undefined) continue;
    statusTotals[row._id] = round2(row.usd || 0);
    statusCounts[row._id] = row.ordenes || 0;
    statusCoins[row._id] = row.monedas || 0;
  }

  const buyers = await ManualOrder.aggregate([
    { $match: { ...match, status: 'approved' } },
    {
      $group: {
        _id: '$user',
        ordenes: { $sum: 1 },
        monedas: { $sum: '$coins' },
        usd: { $sum: '$priceUsd' },
      },
    },
    { $sort: { usd: -1 } },
    { $limit: 20 },
    {
      $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' },
    },
    { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
  ]);

  return {
    ordenes: totals?.ordenes || 0,
    monedas: totals?.monedas || 0,
    usd: round2(totals?.usd || 0),
    // Lo que de verdad entró: solo lo aprobado. Es el número que el panel debe
    // enseñar como "cobrado".
    usdCobrado: statusTotals.approved,
    ordenesCobradas: statusCounts.approved,
    monedasCobradas: statusCoins.approved,
    usdPendiente: statusTotals.pending,
    ordenesPendientes: statusCounts.pending,
    usdRechazado: statusTotals.rejected,
    ordenesRechazadas: statusCounts.rejected,
    compradores: buyers.map((b) => ({
      usuario: b.u?.username || 'desconocido',
      email: b.u?.email || null,
      ordenes: b.ordenes,
      monedas: b.monedas,
      usd: round2(b.usd),
    })),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
async function approveOrder({ orderId, adminId, auto = false, note }) {
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

  // Reparto del dinero (40% admin / 60% bóveda). Va aparte del abono y es
  // idempotente por su propio `externalId`, así que un reintento de aprobación
  // no vuelve a repartir. Se hace después de acreditar para que, si el reparto
  // falla, el comprador ya tenga sus monedas.
  await vaultService
    .settlePurchase({
      externalId: `manual_${order._id}`,
      priceUsd: order.priceUsd,
      method: 'manual',
      userId: order.user,
    })
    .catch((err) => {
      console.warn(`[BÓVEDA] No se pudo registrar la venta ${order._id}: ${err.message}`);
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
      // auditar después por qué se acreditó cada orden. La nota del
      // administrador manda sobre la etiqueta automática.
      reviewNote: note
        ? String(note).slice(0, 300)
        : auto
          ? 'Aprobada automáticamente por el asistente'
          : undefined,
      transaction,
    },
    { new: true }
  ).populate('user', 'username email');

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
  purchaseSummary,
  reviewPending,
  autoApprovePending,
  approveOrder,
  rejectOrder,
};
