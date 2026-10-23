const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const paymentService = require('../services/paymentService');
const paymentMethodService = require('../services/paymentMethodService');
const stripeService = require('../services/stripeService');
const paypalService = require('../services/paypalService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones' },
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones' },
});

// Constant-time comparison so a wrong secret cannot be recovered by timing.
function secretMatches(provided) {
  if (!env.paymentWebhookSecret || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(env.paymentWebhookSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Qué pasarelas puede usar la tienda. El cliente lo consulta para pintar solo
// los botones que van a funcionar: ofrecer "pagar con tarjeta" sin claves
// configuradas sería prometer un cobro que no existe.
router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      providers: paymentService.availableProviders(),
      // Clave publicable de Stripe. No es un secreto: es la que usa el navegador
      // para tokenizar la tarjeta. Se sirve desde aquí para que la tienda no
      // dependa de una variable de compilación del frontend.
      publishableKey: stripeService.publishableKey(),
    });
  })
);

/**
 * Abre un pago y devuelve la URL del proveedor.
 *
 * El paquete se manda por id, nunca el importe: el precio lo pone el servidor.
 * No se acredita nada aquí; eso lo hace el webhook cuando el cobro está
 * confirmado. Volver a la URL de éxito no prueba nada, porque la puede abrir
 * cualquiera.
 */
router.post(
  '/checkout',
  auth,
  checkoutLimiter,
  [
    body('provider').isIn(['stripe', 'paypal']).withMessage('Proveedor no soportado'),
    body('packageId').isString().notEmpty().withMessage('Falta el paquete'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await paymentService.startCheckout({
      provider: req.body.provider,
      userId: req.user.userId,
      packageId: req.body.packageId,
    });
    res.status(201).json(result);
  })
);

/**
 * Webhook de Stripe.
 *
 * La firma se verifica contra el cuerpo crudo que guardó `app.js`. Un evento que
 * no firme correctamente se descarta: es lo único que separa "me pagaron" de
 * "alguien con la URL se inventó un pago".
 */
router.post(
  '/webhook/stripe',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    if (!env.stripeWebhookSecret) {
      throw new HttpError(503, 'Pagos con tarjeta no configurados');
    }

    const signature = req.get('stripe-signature');
    if (!stripeService.verifyWebhookSignature(req.rawBody, signature)) {
      throw new HttpError(401, 'Firma inválida');
    }

    const parsed = stripeService.parseCompletedPayment(req.body);
    // Cualquier otro evento (o uno completado pero sin cobrar) se acepta y se
    // ignora: responder con error haría que Stripe reintentara en bucle.
    if (!parsed) return res.json({ received: true, ignored: true });

    const result = await paymentService.creditPurchase({ ...parsed, provider: 'stripe' });
    res.json({ received: true, ...result });
  })
);

/**
 * Webhook de PayPal.
 *
 * PayPal no firma con HMAC: hay que preguntarle a él si el evento es suyo. La
 * verificación se hace contra el cuerpo crudo, igual que en Stripe.
 */
router.post(
  '/webhook/paypal',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    if (!paypalService.canVerifyWebhooks()) {
      throw new HttpError(503, 'Pagos con PayPal no configurados');
    }

    const authentic = await paypalService.verifyWebhookSignature({
      headers: req.headers,
      rawBody: req.rawBody,
    });
    if (!authentic) throw new HttpError(401, 'Firma inválida');

    const parsed = paypalService.parseCompletedPayment(req.body);
    if (!parsed) return res.json({ received: true, ignored: true });

    const result = await paymentService.creditPurchase({ ...parsed, provider: 'paypal' });
    res.json({ received: true, ...result });
  })
);

/**
 * Payment provider webhook: credits TTC-C after a real purchase.
 *
 * Two properties the original prototype lacked and that matter more than
 * anything else here:
 *
 *  - The price comes from `env.coinPackages`, keyed by package id. A request
 *    cannot ask for 7000 coins while paying for the 70-coin pack.
 *  - `externalId` is the provider's event id and is uniquely indexed, so a
 *    retried webhook credits the account exactly once.
 */
router.post(
  '/webhook',
  webhookLimiter,
  express.json({ limit: '100kb' }),
  asyncHandler(async (req, res) => {
    const { event, userId, packageId, externalId, amountPaid, currency, signature } = req.body;

    // Closed by default: without a configured secret the endpoint refuses
    // everything rather than trusting an unauthenticated POST.
    if (!env.paymentWebhookSecret) {
      throw new HttpError(503, 'Pagos no configurados');
    }
    if (!secretMatches(signature || req.get('x-webhook-signature'))) {
      throw new HttpError(401, 'Firma inválida');
    }

    if (event !== 'checkout.session.completed' && event !== 'payment.succeeded') {
      throw new HttpError(400, 'Evento no soportado');
    }
    if (!externalId) {
      throw new HttpError(400, 'Falta el identificador del evento');
    }

    // Idempotency: a duplicate event id means the provider retried a delivery
    // we already processed.
    const existing = await Transaction.findOne({ externalId });
    if (existing) {
      return res.json({ received: true, duplicate: true });
    }

    const pkg = env.coinPackages.find((p) => p.id === packageId);
    if (!pkg) throw new HttpError(400, 'Paquete de monedas desconocido');

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'wallet.ttcC': pkg.coins } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    try {
      await Transaction.create({
        from: user._id,
        amount: pkg.coins,
        type: 'purchase',
        ttcType: 'ttcC',
        packageId: pkg.id,
        externalId,
        amountPaid: amountPaid ?? pkg.priceUsd,
        currency: currency || 'USD',
        status: 'completed',
        details: `Compra de ${pkg.coins} TTC-C (paquete ${pkg.id})`,
      });
    } catch (err) {
      // A concurrent delivery of the same event lost the unique-index race.
      // Undo this credit so the buyer is not paid twice.
      if (err.code === 11000) {
        await User.updateOne({ _id: user._id }, { $inc: { 'wallet.ttcC': -pkg.coins } });
        return res.json({ received: true, duplicate: true });
      }
      throw err;
    }

    res.json({ received: true, coins: pkg.coins, balance: user.wallet.ttcC });
  })
);

// Packages are published so the client can render the store without hardcoding
// prices. The coin amount and price are authoritative server-side.
router.get(
  '/packages',
  asyncHandler(async (_req, res) => {
    res.json({ packages: env.coinPackages, currency: 'USD' });
  })
);

// --- Métodos de pago guardados --------------------------------------------
//
// Todo este bloque va detrás de `auth`: un método de pago pertenece a una cuenta
// y solo su dueño puede verlo, usarlo o borrarlo. Las consultas del servicio
// filtran siempre por `userId`, así que conocer el id de una tarjeta ajena no
// sirve de nada.

const methodLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones' },
});

// Lista los métodos guardados del usuario.
router.get(
  '/methods',
  auth,
  asyncHandler(async (req, res) => {
    const methods = await paymentMethodService.listMethods({ userId: req.user.userId });
    res.json({
      methods,
      providers: paymentService.availableProviders(),
    });
  })
);

/**
 * Abre el alta de una tarjeta.
 *
 * Devuelve el `client_secret` con el que el navegador guarda la tarjeta contra
 * Stripe. El número no pasa por aquí en ningún momento.
 */
router.post(
  '/methods/card/setup',
  auth,
  methodLimiter,
  asyncHandler(async (req, res) => {
    const setup = await paymentMethodService.startCardSetup({ userId: req.user.userId });
    res.status(201).json(setup);
  })
);

// Guarda una tarjeta ya tokenizada por Stripe.js.
router.post(
  '/methods/card',
  auth,
  methodLimiter,
  [body('paymentMethodId').isString().notEmpty().withMessage('Falta la tarjeta')],
  validate,
  asyncHandler(async (req, res) => {
    const method = await paymentMethodService.saveCard({
      userId: req.user.userId,
      paymentMethodId: req.body.paymentMethodId,
      label: req.body.label,
    });
    res.status(201).json({ method });
  })
);

// Abre el alta de una cuenta de PayPal y devuelve la URL de aprobación.
router.post(
  '/methods/paypal/link',
  auth,
  methodLimiter,
  asyncHandler(async (req, res) => {
    const order = await paymentMethodService.startPaypalLink({ userId: req.user.userId });
    res.status(201).json(order);
  })
);

// Confirma el alta de PayPal cuando el usuario vuelve de aprobarla.
router.post(
  '/methods/paypal/confirm',
  auth,
  methodLimiter,
  [body('orderId').isString().notEmpty().withMessage('Falta la orden de PayPal')],
  validate,
  asyncHandler(async (req, res) => {
    const method = await paymentMethodService.confirmPaypalLink({
      userId: req.user.userId,
      orderId: req.body.orderId,
    });
    res.status(201).json({ method });
  })
);

// Marca un método como predeterminado.
router.post(
  '/methods/:id/default',
  auth,
  methodLimiter,
  asyncHandler(async (req, res) => {
    const method = await paymentMethodService.setDefault({
      userId: req.user.userId,
      methodId: req.params.id,
    });
    res.json({ method });
  })
);

// Borra un método guardado.
router.delete(
  '/methods/:id',
  auth,
  methodLimiter,
  asyncHandler(async (req, res) => {
    const result = await paymentMethodService.removeMethod({
      userId: req.user.userId,
      methodId: req.params.id,
    });
    res.json(result);
  })
);

/**
 * Cobra un paquete con un método guardado.
 *
 * El cobro se hace aquí, pero las monedas las acredita el webhook del proveedor:
 * es la única fuente que prueba que el dinero entró de verdad. Acreditar en esta
 * respuesta dejaría monedas regaladas si el banco rechaza el cargo después.
 */
router.post(
  '/methods/:id/pay',
  auth,
  checkoutLimiter,
  [
    body('packageId').isString().notEmpty().withMessage('Falta el paquete'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await paymentMethodService.chargeWithSavedMethod({
      userId: req.user.userId,
      methodId: req.params.id,
      packageId: req.body.packageId,
    });
    res.status(201).json({
      ...result,
      message:
        'Pago enviado. Las monedas aparecerán en tu monedero en unos segundos.',
    });
  })
);

module.exports = router;
