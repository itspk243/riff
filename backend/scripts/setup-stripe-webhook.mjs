#!/usr/bin/env node
//
// Register the Stripe webhook against the deployed Vercel URL.
// Run this AFTER the Vercel deployment is live (so the URL is reachable).
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... RIFF_PUBLIC_URL=https://riff-wheat-sigma.vercel.app \
//     node backend/scripts/setup-stripe-webhook.mjs
//
// (or just run with --env-file=.env.local)
//
// Output: prints the webhook signing secret (whsec_...) — paste into Vercel
// env vars as STRIPE_WEBHOOK_SECRET, then redeploy.
//
// Idempotent: safe to re-run. Updates existing webhook with same URL.

const KEY = process.env.STRIPE_SECRET_KEY;
const BASE = process.env.RIFF_PUBLIC_URL;
if (!KEY) { console.error('STRIPE_SECRET_KEY required'); process.exit(1); }
if (!BASE) { console.error('RIFF_PUBLIC_URL required'); process.exit(1); }

const ENDPOINT_URL = `${BASE.replace(/\/$/, '')}/api/billing/webhook`;
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];
const STRIPE = 'https://api.stripe.com/v1';

async function stripe(method, path, body) {
  const headers = {
    Authorization: `Basic ${Buffer.from(KEY + ':').toString('base64')}`,
  };
  let formBody;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) {
        v.forEach(item => params.append(`${k}[]`, item));
      } else {
        params.set(k, v);
      }
    }
    formBody = params.toString();
  }
  const res = await fetch(`${STRIPE}${path}`, { method, headers, body: formBody });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  console.log(`Looking for existing webhook at ${ENDPOINT_URL}...`);
  const existing = await stripe('GET', '/webhook_endpoints?limit=100');
  const match = existing.data?.find(e => e.url === ENDPOINT_URL);

  let endpoint;
  if (match) {
    console.log(`→ Webhook already exists (${match.id}). Updating events list.`);
    endpoint = await stripe('POST', `/webhook_endpoints/${match.id}`, {
      enabled_events: EVENTS,
    });
    console.log('  NOTE: Stripe only shows the signing secret on initial creation.');
    console.log('        If you need a fresh secret, delete this webhook in dashboard and re-run.');
  } else {
    console.log(`→ Creating new webhook for ${ENDPOINT_URL}`);
    endpoint = await stripe('POST', '/webhook_endpoints', {
      url: ENDPOINT_URL,
      enabled_events: EVENTS,
    });
    console.log(`✓ Created webhook ${endpoint.id}`);
  }

  console.log('\n=========================================================');
  if (endpoint.secret) {
    console.log('SIGNING SECRET (paste into Vercel env vars):');
    console.log('');
    console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
  } else {
    console.log('Webhook updated — but Stripe does not return secrets on update.');
    console.log('To get a fresh secret: delete the webhook in Stripe dashboard,');
    console.log(`then re-run this script: ${endpoint.url}`);
  }
  console.log('=========================================================');
})().catch(e => { console.error(e); process.exit(1); });
