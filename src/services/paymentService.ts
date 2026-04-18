import Stripe from 'stripe';
import { config } from '../config';
import { Errors } from '../middleware/errorHandler';

const stripe = config.STRIPE_SECRET_KEY
  ? new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2023-11-15' })
  : undefined;

const planPriceMap: Record<'basic' | 'pro' | 'agency', string | undefined> = {
  basic: config.STRIPE_PRICE_BASIC,
  pro: config.STRIPE_PRICE_PRO,
  agency: config.STRIPE_PRICE_AGENCY,
};

class PaymentService {
  private ensureStripe(): Stripe {
    if (!stripe) {
      throw Errors.ServiceUnavailable('Stripe is not configured for payments');
    }
    return stripe;
  }

  async retrieveCustomer(customerId: string) {
    const stripeClient = this.ensureStripe();
    try {
      const customer = await stripeClient.customers.retrieve(customerId);
      if (customer.deleted) {
        throw Errors.NotFound('Stripe customer not found');
      }
      return customer;
    } catch (error: any) {
      if (error?.type === 'StripeInvalidRequestError') {
        throw Errors.NotFound('Stripe customer not found');
      }
      throw error;
    }
  }

  async createCustomer(data: { email: string; name: string; phone: string }) {
    const stripeClient = this.ensureStripe();
    return stripeClient.customers.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
    });
  }

  async createCheckoutSession(data: {
    customerId: string;
    userId: string;
    plan: 'basic' | 'pro' | 'agency';
  }) {
    const stripeClient = this.ensureStripe();
    const priceId = planPriceMap[data.plan];

    if (!priceId) {
      throw Errors.ServiceUnavailable(`Stripe price ID is not configured for plan: ${data.plan}`);
    }

    return stripeClient.checkout.sessions.create({
      customer: data.customerId,
      client_reference_id: data.userId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: config.STRIPE_SUCCESS_URL,
      cancel_url: config.STRIPE_CANCEL_URL,
      metadata: {
        userId: data.userId,
      },
    });
  }

  async retrieveSession(sessionId: string) {
    const stripeClient = this.ensureStripe();
    return stripeClient.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription'],
    });
  }
}

export const paymentService = new PaymentService();