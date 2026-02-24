import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: '2026-01-28.clover' })
  : null;

export const createPaymentIntent = async (amount: number, currency: string = 'usd') => {
  if (!stripe) {
    console.log('⚠️ Stripe no configurado - modo simulación');
    return {
      id: 'simulated_' + Date.now(),
      client_secret: 'simulated_secret_' + Date.now(),
      amount,
      currency
    };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        integration: 'taktak_app'
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
  if (!stripe) {
    console.log('⚠️ Stripe no configurado - confirmación simulada');
    return { status: 'succeeded', simulated: true };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100
    };
  } catch (error) {
    console.error('Error confirming payment:', error);
    throw error;
  }
};

export const createCustomer = async (email: string, name: string) => {
  if (!stripe) {
    return { id: 'simulated_customer_' + Date.now() };
  }

  try {
    const customer = await stripe.customers.create({
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
  if (!stripe) {
    console.log('⚠️ Stripe no configurado - suscripción simulada');
    return {
      id: 'simulated_sub_' + Date.now(),
      status: 'active',
      simulated: true
    };
  }

  try {
    const subscription = await stripe.subscriptions.create({
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
  if (!stripe) {
    return { status: 'active', simulated: true };
  }

  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error('Error getting subscription:', error);
    throw error;
  }
};

export const cancelSubscription = async (subscriptionId: string) => {
  if (!stripe) {
    return { status: 'canceled', simulated: true };
  }

  try {
    return await stripe.subscriptions.cancel(subscriptionId);
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
};

// Webhook handler for Stripe events
export const handleWebhook = (payload: Buffer, signature: string) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.log('⚠️ Webhook simulado');
    return { received: true, simulated: true };
  }

  try {
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

    return { received: true };
  } catch (error) {
    console.error('Error handling webhook:', error);
    throw error;
  }
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
