import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: '2026-01-28.clover' })
  : null;

/**
 * Payment operations fail closed. A missing key used to fall through to a
 * simulated success, which meant any caller could "confirm" a payment that was
 * never charged. Nothing here may report success without Stripe confirming it.
 */
function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe no está configurado (falta STRIPE_SECRET_KEY). No se procesan pagos.');
  }
  return stripe;
}

export const createPaymentIntent = async (amount: number, currency: string = 'usd', metadata: Record<string, string> = {}) => {
  const client = requireStripe();

  try {
    const paymentIntent = await client.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        integration: 'taktak_app',
        ...metadata
      }
    });

    return {
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency
    };
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw error;
  }
};

export const confirmPayment = async (paymentIntentId: string) => {
  const client = requireStripe();

  try {
    const paymentIntent = await client.paymentIntents.retrieve(paymentIntentId);
    return {
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100,
      metadata: paymentIntent.metadata
    };
  } catch (error) {
    console.error('Error confirming payment:', error);
    throw error;
  }
};

export const createCustomer = async (email: string, name: string) => {
  const client = requireStripe();

  try {
    const customer = await client.customers.create({
      email,
      name,
      metadata: {
        app: 'taktak'
      }
    });
    return customer;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
};

export const createSubscription = async (customerId: string, priceId: string) => {
  const client = requireStripe();

  try {
    const subscription = await client.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    });

    return subscription;
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
};

export const getSubscription = async (subscriptionId: string) => {
  const client = requireStripe();

  try {
    return await client.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error('Error getting subscription:', error);
    throw error;
  }
};

export const cancelSubscription = async (subscriptionId: string) => {
  const client = requireStripe();

  try {
    return await client.subscriptions.cancel(subscriptionId);
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
};

// Webhook handler for Stripe events
export const handleWebhook = (payload: Buffer, signature: string) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    throw new Error('Webhook no verificable: falta STRIPE_SECRET_KEY o STRIPE_WEBHOOK_SECRET.');
  }

  // constructEvent throws when the signature does not match, so an unsigned or
  // forged request can never reach the switch below.
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('✅ Pago exitoso:', event.data.object);
      break;
    case 'payment_intent.payment_failed':
      console.log('❌ Pago fallido:', event.data.object);
      break;
    case 'customer.subscription.created':
      console.log('✅ Suscripción creada:', event.data.object);
      break;
    case 'customer.subscription.deleted':
      console.log('❌ Suscripción cancelada:', event.data.object);
      break;
    default:
      console.log('📝 Evento de Stripe:', event.type);
  }

  return { received: true, event };
};

export default {
  stripe,
  createPaymentIntent,
  confirmPayment,
  createCustomer,
  createSubscription,
  getSubscription,
  cancelSubscription,
  handleWebhook
};
