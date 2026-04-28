// Stripe client + helpers for Checkout and Customer Portal flows.

import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

export const PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY!;
export const PRICE_TEAM_MONTHLY = process.env.STRIPE_PRICE_TEAM_MONTHLY!;

export async function createCheckoutSession(opts: {
  userId: string;
  email: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: opts.email,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.userId,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId: opts.userId },
    },
  });
}

export async function createPortalSession(opts: { customerId: string; returnUrl: string }) {
  return stripe.billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
}
