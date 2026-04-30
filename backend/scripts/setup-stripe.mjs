#!/usr/bin/env node
//
// One-shot Stripe setup. Idempotent — safe to re-run.
// Creates: Pro product + price ($14.99/mo), Plus product + price ($19.99/mo),
// and a FOUNDER50 coupon (50% off for 3 months, max 100 redemptions).
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... node backend/scripts/setup-stripe.mjs
//
// Output: prints the price IDs you need to paste into .env.local + Vercel.

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('STRIPE_SECRET_KEY required'); process.exit(1); }

const STRIPE = 'https://api.stripe.com/v1';

async function stripe(method, path, body) {
  const headers = {
    Authorization: `Basic ${Buffer.from(KEY + ':').toString('base64')}`,
  };
  let formBody;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    formBody = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${STRIPE}${path}`, { method, headers, body: formBody });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function findOrCreateProductWithPrice(opts) {
  // Search existing products by metadata key 'riff_id' so we don't double-create
  const search = await stripe('GET', `/products/search?query=metadata['riff_id']:'${opts.riffId}'`);
  let product = search.data?.[0];
  if (!product) {
    product = await stripe('POST', '/products', {
      name: opts.name,
      'metadata[riff_id]': opts.riffId,
    });
    console.log(`✓ Created product ${opts.name} (${product.id})`);
  } else {
    console.log(`→ Product ${opts.name} already exists (${product.id})`);
  }

  // List existing prices for this product
  const prices = await stripe('GET', `/prices?product=${product.id}&active=true&limit=5`);
  let price = prices.data.find(p =>
    p.unit_amount === opts.unitAmount &&
    p.currency === 'usd' &&
    p.recurring?.interval === 'month'
  );
  if (!price) {
    price = await stripe('POST', '/prices', {
      product: product.id,
      unit_amount: String(opts.unitAmount),
      currency: 'usd',
      'recurring[interval]': 'month',
    });
    console.log(`✓ Created price $${opts.unitAmount / 100}/mo (${price.id})`);
  } else {
    console.log(`→ Price $${opts.unitAmount / 100}/mo already exists (${price.id})`);
  }
  return { productId: product.id, priceId: price.id };
}

async function findOrCreateCoupon() {
  // Stripe doesn't allow editing coupon duration after creation — if an existing
  // coupon has the wrong duration, we delete and recreate.
  const desiredDurationMonths = 3;

  try {
    const existing = await stripe('GET', '/coupons/FOUNDER50');
    if (existing && existing.id === 'FOUNDER50') {
      const matches =
        existing.duration === 'repeating' &&
        existing.duration_in_months === desiredDurationMonths &&
        existing.percent_off === 50 &&
        existing.max_redemptions === 100;
      if (matches) {
        console.log(`→ Coupon FOUNDER50 already exists with correct config (50% off · 3 months · ${existing.times_redeemed}/${existing.max_redemptions} used)`);
        return existing;
      }
      // Wrong config — delete and recreate
      console.log(`→ Coupon FOUNDER50 exists with old config (duration=${existing.duration}). Deleting to recreate.`);
      await stripe('DELETE', '/coupons/FOUNDER50');
    }
  } catch (e) {
    // Doesn't exist yet, create it
  }

  const coupon = await stripe('POST', '/coupons', {
    id: 'FOUNDER50',
    percent_off: '50',
    duration: 'repeating',
    duration_in_months: String(desiredDurationMonths),
    max_redemptions: '100',
    name: 'Founder pricing — first 100',
  });
  console.log(`✓ Created coupon FOUNDER50 (50% off for 3 months, max 100 redemptions)`);
  return coupon;
}

(async () => {
  console.log('Setting up Stripe products...\n');

  // Current pricing (rifflylabs.com landing + dashboard):
  //   Pro  — $14.99/mo  (drafting features)
  //   Plus — $19.99/mo  (agentic features: saved-search digest, profile assist)
  // Team is grandfathered legacy ($99/mo). We still create it so the price id
  // exists in env — but we don't surface it in the UI.
  const pro = await findOrCreateProductWithPrice({
    riffId: 'riff_pro_monthly_v2',
    name: 'Riffly Pro',
    unitAmount: 1499,
  });

  const plus = await findOrCreateProductWithPrice({
    riffId: 'riff_plus_monthly_v1',
    name: 'Riffly Plus',
    unitAmount: 1999,
  });

  const team = await findOrCreateProductWithPrice({
    riffId: 'riff_team_monthly_v1',
    name: 'Riffly Team (legacy)',
    unitAmount: 9900,
  });

  await findOrCreateCoupon();

  console.log('\n✓ Done. Add these to .env.local and Vercel env vars:\n');
  console.log(`STRIPE_PRICE_PRO_MONTHLY=${pro.priceId}`);
  console.log(`STRIPE_PRICE_PLUS_MONTHLY=${plus.priceId}`);
  console.log(`STRIPE_PRICE_TEAM_MONTHLY=${team.priceId}`);
  console.log('\nWebhook secret comes next — run setup-stripe-webhook.mjs once Vercel is live.');
})().catch(e => { console.error(e); process.exit(1); });
