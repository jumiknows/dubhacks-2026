import { test, expect } from '@playwright/test';
import { webcrypto } from 'node:crypto';

const offers = [
  { id: 'offer-a', title: 'Trail tent', store: 'Sample Outdoors', price: 80, currency: 'USD', inStock: true, isMock: true, source: 'demo_catalog', trust: .8, flags: [], shippingDays: 3 },
  { id: 'offer-b', title: 'Camp tent', store: 'Sample Camp', price: 60, currency: 'USD', inStock: true, isMock: true, source: 'demo_catalog', trust: .7, flags: [] },
];
function samplePlan(id = 'plan-a', name = 'Tent') {
  return { id, title: `${name} plan`, prompt: `I need a ${name.toLowerCase()}`, category: 'camping', status: 'ready', items: [{ id: `${id}-item`, name, quantity: 1, reason: 'Sleep outside', products: offers, synthesis: { best: offers[0], totalPrice: 80, currency: 'USD', summary: 'Trail tent', warnings: ['Sample offers; no live merchant lookup.'] }, purchased: false, owned: false }] };
}
async function setup(page, handle = () => null) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const result = await handle(path, route.request());
    if (result) return route.fulfill(result);
    if (path === '/api/me') return route.fulfill({ json: { profile: { completedAt: '2026-10-18' }, google: { available: false }, user: null } });
    if (path === '/api/voice-health' || path === '/api/conjure/health') return route.fulfill({ json: { integrations: { gemini_live: 'not configured', llm: 'not configured' } } });
    if (path === '/api/health') return route.fulfill({ json: { ok: true, stripe: 'mock' } });
    if (path === '/api/plans') return route.fulfill({ json: { plans: [] } });
    return route.fulfill({ status: 404, json: { error: `Unexpected test request: ${path}` } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where are you headed?' })).toBeVisible();
}

test('multiple plans retain selected offers through comparison, deliberate cart and mock checkout', async ({ page }) => {
  const errors = []; page.on('pageerror', (err) => errors.push(err.message));
  const plans = []; let serial = 0; let selected;
  await setup(page, (path, req) => {
    if (path === '/api/plans' && req.method() === 'POST') { const next = samplePlan(`plan-${++serial}`, serial === 1 ? 'Tent' : 'Boots'); plans.push(next); return { json: next }; }
    if (path === '/api/plans') return { json: { plans: plans.slice().reverse() } };
    const stored = plans.find((plan) => path === `/api/plans/${plan.id}`);
    if (stored) return { json: stored };
    if (path.endsWith('/listing')) { selected = req.postDataJSON().listingId; plans[0].items[0].synthesis = { best: offers[1], totalPrice: 60, currency: 'USD' }; return { json: plans[0] }; }
    if (path === '/api/compare') return { json: { left: offers[0], right: offers[1], pick: 'right', reasons: ['Lower price within your trust floor.'], axes: [{ name: 'Price', left: '$80', right: '$60' }] } };
    if (path === '/api/checkout') { expect(req.postDataJSON()).toEqual({ cart: [{ planId: 'plan-1', itemIds: ['plan-1-item'] }, { planId: 'plan-2', itemIds: ['plan-2-item'] }] }); return { json: { id: 'mock-1', mock: true, amount: 14000, currency: 'usd' } }; }
    if (path === '/api/checkout/mock-1') { plans.forEach((plan) => { plan.items[0].purchased = true; }); return { json: { status: 'paid', mock: true, plan: plans[0], plans, receipt: { orderId: 'MOCK-1', amount: 14000, currency: 'usd', card: { last4: '4242' }, placedAt: '2026-10-18T12:00:00Z', sandboxes: [], local: ['plan-1-item', 'plan-2-item'] } } }; }
    return null;
  });
  await page.getByLabel('Plan prompt').fill('A tent for camping'); await page.getByRole('button', { name: 'Build list', exact: true }).click();
  await page.getByRole('button', { name: 'Open Tent plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tent product options', exact: true });
  await expect(dialog).toContainText('Demo data');
  await dialog.getByRole('button', { name: 'Compare best two', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare Tent listings', exact: true });
  await expect(comparison.getByRole('heading', { name: 'Camp tent wins', exact: true })).toBeVisible();
  await expect(comparison).toContainText('Sample Camp is $20.00 cheaper');
  await comparison.getByRole('button', { name: 'Choose B + add to cart', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Cart, 1 item/ })).toContainText('$60.00');
  expect(selected).toBe('offer-b');
  await expect(dialog.locator('[data-gesture-id="product:plan-1-item:offer-b"]')).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Plan prompt').fill('Boots for camping'); await page.getByRole('button', { name: 'Build list', exact: true }).click();
  await expect(page.locator('.shop-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Open Boots plan', exact: true }).click();
  const boots = page.getByRole('dialog', { name: 'Boots product options', exact: true });
  await boots.getByRole('button', { name: 'Add chosen to cart', exact: true }).click();
  await boots.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Cart, 2 items/ }).click();
  const cart = page.getByRole('dialog', { name: 'Cart and checkout', exact: true });
  await cart.getByRole('button', { name: 'Check out $140.00', exact: true }).click();
  await expect(cart).toContainText('Demo checkout');
  await cart.getByRole('button', { name: 'Place mock order', exact: true }).click();
  await expect(cart).toContainText('MOCK-1');
  await expect(cart).toContainText(/no card was charged/i);
  await cart.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await expect(page.locator('.shop-group')).toHaveCount(2);
  await expect(page.locator('[data-group-id="plan-1"]')).toContainText('Purchased');
  await expect(page.locator('[data-group-id="plan-2"]')).toContainText('Purchased');
  await page.getByRole('button', { name: 'Open Tent plan', exact: true }).click();
  await expect(page.locator('[data-gesture-id="product:plan-1-item:offer-b"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('review insights and website holds stay evidence based and visible in the workspace', async ({ page }) => {
  await setup(page, (path) => {
    if (path === '/api/conjure/reviews/demo') return { json: { source: { status: 'demo', is_mock: true }, summary: 'Two synthetic reviews were analyzed.', analysis: { received_count: 2, analyzed_count: 2, ratings: { mean_five: 4 }, sentiment: { counts: { positive: 1, mixed: 1 } }, recurring_aspects: [], limitations: ['Sample opinions are not proof of authenticity.'] } } };
    if (path === '/api/conjure/websites/assess') return { json: { decision: 'hold', allowed: false, origin: 'https://shop.example', summary: 'Reputation evidence is unavailable.', evidence: [{ detail: 'No provider is configured.' }], limitations: ['Safety is not guaranteed.'] } };
    return null;
  });
  await page.getByRole('button', { name: 'Reviews & website safety' }).click();
  await page.getByRole('button', { name: 'Analyze demo reviews' }).click(); await expect(page.getByText('Synthetic demo reviews', { exact: true })).toBeVisible();
  await page.getByLabel('Website URL').fill('https://shop.example/product'); await page.getByRole('button', { name: 'Check website', exact: true }).click();
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Open checked website' })).toHaveCount(0);
});

test('assistant streams products and browser signs separate rules and exact demo cart payload', async ({ page }) => {
  const product = { id: 'cream-1', title: 'Gentle Cream', brand: 'Sample Lab', price: 20, rating_listed: 4.5, summary: 'Fictional fragrance-free moisturizer' };
  const cartPayload = '{"session_id":"session-1","nonce":"exact-order","total":20}';
  let publicKey; let signatures = 0;
  await setup(page, async (path, req) => {
    if (path === '/api/conjure/session') return { json: { session_id: 'session-1' } };
    if (path === '/api/conjure/chat') return { contentType: 'text/event-stream', body: `: heartbeat\n\nevent: action\ndata: ${JSON.stringify({ action: 'show_results', product_ids: [product.id] })}\n\nevent: say\ndata: {"text":"Here is a gentle option."}\n\nevent: done\ndata: {"source":"fallback","grounded":true}\n\n` };
    if (path === '/api/conjure/products/cream-1') return { json: product };
    if (path === '/api/conjure/mandate/intent') {
      const body = req.postDataJSON(); expect(Object.keys(body.public_key_jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
      publicKey = await webcrypto.subtle.importKey('jwk', body.public_key_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, Buffer.from(body.signature, 'base64'), new TextEncoder().encode(body.payload))).toBe(true); signatures++;
      expect(JSON.parse(body.payload)).toMatchObject({ session_id: 'session-1', budget_max: 50, verified_only: true, autonomy: 'stage' });
      return { json: { mandate_id: 'mandate-1' } };
    }
    if (path === '/api/conjure/checkout/stage') return { json: { action: 'stage_checkout', cart_payload: cartPayload, cart: { items: [{ product_id: product.id, title: product.title, unit_price: 20, quantity: 1 }], total: 20, currency: 'usd', cart_hash: 'hash-1' }, policy: { allowed: true, checks: [{ rule: 'budget', passed: true, reason: 'Within signed budget.' }] } } };
    if (path === '/api/conjure/checkout/intent') {
      const body = req.postDataJSON(); expect(body.cart_hash).toBe('hash-1');
      expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, Buffer.from(body.signature, 'base64'), new TextEncoder().encode(cartPayload))).toBe(true); signatures++;
      return { json: { mock: true, amount: 2000, currency: 'usd', payment_intent_id: 'pi_demo' } };
    }
    return null;
  });
  await page.getByRole('button', { name: 'Shopping assistant', exact: true }).click();
  await page.getByLabel('Ask the assistant').fill('Find a gentle moisturizer'); await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gentle Cream' })).toBeVisible(); await expect(page.getByText('Here is a gentle option.')).toBeVisible();
  await page.getByText('Signed shopping rules & demo cart', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign these shopping rules' }).click();
  await expect(page.getByText(/Active signed rules/)).toBeVisible();
  await page.getByRole('button', { name: 'Propose demo cart' }).click(); await page.getByRole('button', { name: 'Sign demo cart', exact: true }).click();
  await expect(page.getByText(/Simulated authorization for/)).toBeVisible(); expect(signatures).toBe(2);
});

test('pending mock checkout survives reload and cancellation restores the editable cart', async ({ page }) => {
  const plan = samplePlan('cancel-plan', 'Tent');
  let cancelled = false;
  await setup(page, (path, req) => {
    if (path === '/api/plans') return { json: { plans: [plan] } };
    if (path === '/api/plans/cancel-plan') return { json: plan };
    if (path.endsWith('/listing')) return { json: plan };
    if (path === '/api/checkout') { expect(req.postDataJSON()).toEqual({ cart: [{ planId: plan.id, itemIds: [plan.items[0].id] }] }); return { json: { id: 'cancel-mock', mock: true, amount: 8000, currency: 'usd' } }; }
    if (path === '/api/checkout/cancel-mock/cancel') { cancelled = true; return { json: { status: 'cancelled', mock: true, plan } }; }
    return null;
  });
  await page.getByRole('button', { name: 'Open Tent plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tent product options', exact: true });
  await dialog.getByRole('button', { name: 'Add chosen to cart', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Cart, 1 item/ }).click();
  await page.getByRole('button', { name: 'Check out $80.00', exact: true }).click();
  await page.reload();
  const cart = page.getByRole('dialog', { name: 'Cart and checkout', exact: true });
  await expect(cart).toContainText('Demo checkout');
  await cart.getByRole('button', { name: 'Back to cart', exact: true }).click();
  await expect(cart).not.toContainText('Demo checkout');
  await expect(cart.getByRole('button', { name: 'Check out $80.00', exact: true })).toBeEnabled();
  expect(cancelled).toBe(true);
});
