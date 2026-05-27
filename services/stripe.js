
// services/stripe.js
const Stripe = require('stripe');

module.exports = {
  createCheckoutSession: async ({ items, subtotal, deliveryFee, successUrl, cancelUrl, productName }) => {
    const stripeClient = Stripe(process.env.STRIPE_SECRET_KEY);
    
    const total = Number(subtotal) + Number(deliveryFee);
    const name = productName || 'Vaniday Payment';
    const currency = String(process.env.STRIPE_CURRENCY || 'sgd').toLowerCase();

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card', 'grabpay', 'alipay', 'paynow', 'wechat_pay'],
      payment_method_options: {
        wechat_pay: { client: 'web' }
      },

      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: name,
            },
            unit_amount: Math.round(total * 100), // cents
          },
          quantity: 1,
        }
      ],

      mode: 'payment',

      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return session;
  },

  createWalletTopupSession: async ({ amount, successUrl, cancelUrl, paymentMethodTypes }) => {
    // Initialize Stripe fresh on each call with current secret key
    const stripeClient = Stripe(process.env.STRIPE_SECRET_KEY);
    
    const topupAmount = Number(amount || 0);
    if (!Number.isFinite(topupAmount) || topupAmount <= 0) {
      throw new Error("Invalid top-up amount");
    }

    const pmTypes = paymentMethodTypes || ['card'];
    const paymentMethodOptions = pmTypes.includes('wechat_pay') ? { wechat_pay: { client: 'web' } } : undefined;

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: pmTypes,
      payment_method_options: paymentMethodOptions,
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            product_data: { name: 'Vaniday Wallet Top Up' },
            unit_amount: Math.round(topupAmount * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'wallet_topup',
        amount: topupAmount.toFixed(2)
      }
    });

    return session;
  },

  retrieveCheckoutSession: async (sessionId) => {
    // Initialize Stripe fresh on each call with current secret key
    const stripeClient = Stripe(process.env.STRIPE_SECRET_KEY);
    
    if (!sessionId) throw new Error("Missing Stripe session ID");
    return stripeClient.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "customer_details"]
    });
  },

  refundPaymentIntent: async ({ paymentIntentId, amount }) => {
    // Initialize Stripe fresh on each call with current secret key
    const stripeClient = Stripe(process.env.STRIPE_SECRET_KEY);
    
    if (!paymentIntentId) throw new Error("Missing Stripe payment_intent");
    const cents = Math.round(Number(amount || 0) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error("Invalid refund amount");
    }
    return stripeClient.refunds.create({
      payment_intent: paymentIntentId,
      amount: cents
    });
  }
};
