import { Router, Request, Response } from 'express';
import { createPaymentIntent, createCustomer, createSubscription, confirmPayment, cancelSubscription } from '../services/stripe';

const router = Router();

router.post('/create-intent', async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'usd' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const paymentIntent = await createPaymentIntent(amount, currency);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: 'Error al procesar el pago' });
  }
});

router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.body;
    const result = await confirmPayment(paymentId);

    if (result.status === 'succeeded') {
      res.json({ success: true, message: 'Pago procesado', amount: result.amount });
    } else {
      res.status(400).json({ error: 'Pago no completado' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error al confirmar' });
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

router.post('/webhook', async (req: Request, res: Response) => {
  console.log('📝 Webhook de Stripe recibido');
  res.json({ received: true });
});

export default router;
