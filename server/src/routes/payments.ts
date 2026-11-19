import { Router, Request, Response } from 'express';
import { createPaymentIntent, createCustomer, createSubscription, confirmPayment, cancelSubscription, handleWebhook } from '../services/stripe.js';
import { giftService } from '../services/gift.js';
import { miningService } from '../services/mining.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { Transaction } from '../models/Transaction.js';

const router = Router();

/**
 * Prices live on the server. Previously the client sent `amount` and the server
 * charged it verbatim, so a caller could buy 2000 credits for $0.01.
 */
const COIN_PACKAGES: Record<string, { price: number; credits: number }> = {
  basic: { price: 4.99, credits: 100 },
  standard: { price: 9.99, credits: 250 },
  premium: { price: 19.99, credits: 600 },
  vip: { price: 49.99, credits: 2000 },
};

router.post('/create-intent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { packageId, currency = 'usd' } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const pkg = COIN_PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({ error: 'Paquete desconocido', available: Object.keys(COIN_PACKAGES) });
    }

    const paymentIntent = await createPaymentIntent(pkg.price, currency, {
      userId,
      packageId,
      credits: String(pkg.credits)
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      credits: pkg.credits
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    res.status(503).json({ error: error.message || 'Error al procesar el pago' });
  }
});

router.post('/confirm', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { paymentId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId requerido' });
    }

    const result = await confirmPayment(paymentId);

    // The intent must belong to the caller, otherwise anyone could confirm
    // somebody else's payment and have the credits land on their own account.
    if (result.metadata?.userId !== userId) {
      return res.status(403).json({ error: 'Este pago no pertenece a tu cuenta' });
    }

    if (result.status !== 'succeeded') {
      return res.status(400).json({ error: 'Pago no completado', status: result.status });
    }

    // Idempotent on the Stripe intent id: a retry returns the original row
    // instead of crediting the same purchase twice.
    let alreadyProcessed = false;
    try {
      await Transaction.create({
        receiverId: userId,
        type: 'deposit',
        amount: result.amount,
        fee: 0,
        status: 'completed',
        idempotencyKey: `stripe:${paymentId}`,
        metadata: {
          packageId: result.metadata?.packageId,
          credits: result.metadata?.credits,
          source: 'confirm'
        }
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        alreadyProcessed = true;
      } else {
        throw err;
      }
    }

    res.json({
      success: true,
      message: alreadyProcessed ? 'Pago ya procesado previamente' : 'Pago procesado',
      amount: result.amount,
      alreadyProcessed
    });
  } catch (error: any) {
    console.error('Error confirming payment:', error);
    res.status(503).json({ error: error.message || 'Error al confirmar' });
  }
});

router.post('/customer', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Email y nombre requeridos' });
    }
    const customer = await createCustomer(email, name);
    res.json({ success: true, customerId: customer.id });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { customerId, priceId } = req.body;
    if (!customerId || !priceId) {
      return res.status(400).json({ error: 'Cliente y plan requeridos' });
    }
    const subscription = await createSubscription(customerId, priceId);
    res.json({ success: true, subscriptionId: subscription.id, status: subscription.status });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear suscripción' });
  }
});

router.post('/cancel-subscription', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'ID requerido' });
    }
    const result = await cancelSubscription(subscriptionId);
    res.json({ success: true, status: result.status });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al cancelar' });
  }
});

router.get('/plans', (req: Request, res: Response) => {
  const plans = [
    { id: 'price_premium_monthly', name: 'Premium Mensual', price: 4.99, interval: 'month', features: ['Sin anuncios', 'Fichas ilimitadas', 'Badges exclusivos'] },
    { id: 'price_premium_yearly', name: 'Premium Anual', price: 39.99, interval: 'year', features: ['Todo mensual', '20% descuento', 'Soporte prioritario'] }
  ];
  res.json({ plans });
});

/**
 * Stripe signs the exact bytes it sent, so this route must receive a raw Buffer
 * instead of the JSON-parsed body used everywhere else. `handleWebhook` throws
 * when the signature is missing or wrong, which stops forged events here.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];

  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Falta la cabecera stripe-signature' });
  }

  try {
    const { event } = handleWebhook(req.body as Buffer, signature);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as any;
      try {
        await Transaction.create({
          receiverId: intent.metadata?.userId,
          type: 'deposit',
          amount: intent.amount_received / 100,
          fee: 0,
          status: 'completed',
          idempotencyKey: `stripe:${intent.id}`,
          metadata: {
            packageId: intent.metadata?.packageId,
            credits: intent.metadata?.credits,
            source: 'webhook'
          }
        });
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        console.log(`ℹ️ Evento duplicado ignorado para ${intent.id}`);
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook rechazado:', error.message);
    res.status(400).json({ error: 'Firma de webhook inválida' });
  }
});

router.post('/gift', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { receiverId, coinAmount } = req.body;
    const senderId = req.user?.id;

    if (!receiverId || !coinAmount || coinAmount <= 0) {
      return res.status(400).json({ error: 'Datos de regalo inválidos' });
    }

    const result = await giftService.sendGift(senderId!, receiverId, coinAmount);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/withdraw', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, details } = req.body;
    const userId = req.user?.id;

    if (!amount || amount <= 0 || !method) {
      return res.status(400).json({ error: 'Datos de retiro inválidos' });
    }

    const transaction = await giftService.requestWithdrawal(userId!, amount, method, details);
    res.json({ success: true, transactionId: transaction._id, status: transaction.status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/mine', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { megabytesServed } = req.body;
    const userId = req.user?.id;

    if (!megabytesServed || megabytesServed <= 0) {
      return res.status(400).json({ error: 'Datos de minado inválidos' });
    }

    const result = await miningService.rewardSeeding(userId!, megabytesServed);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { creatorId, type, duration, isCompletion80 } = req.body;
    const userId = req.user?.id;

    if (!creatorId || !type) {
      return res.status(400).json({ error: 'Datos de actividad inválidos' });
    }

    await miningService.recordActivity(userId!, creatorId, { type, duration, isCompletion80 });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/mining-report', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const report = req.body;

    if (!userId || !report) {
      return res.status(400).json({ error: 'Datos de reporte inválidos' });
    }

    const result = await miningService.recordMiningReport(userId, report);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
