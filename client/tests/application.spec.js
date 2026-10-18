import { test, expect } from '@playwright/test';

const completedProfile = { completedAt: '2026-10-18T12:00:00Z' };
const plannerHeading = 'Where are you headed?';

async function mockApi(page, handle = () => null) {
  const unexpected = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const response = await handle(path, request);
    if (response) return route.fulfill(response);
    if (path === '/api/me') return route.fulfill({ json: { profile: completedProfile, google: { available: false }, user: null } });
    if (path === '/api/plans' && request.method() === 'GET') return route.fulfill({ json: { plans: [] } });
    if (path === '/api/voice-health' || path === '/api/conjure/health') return route.fulfill({ json: { integrations: { gemini_live: 'not configured', llm: 'not configured' } } });
    if (path === '/api/health') return route.fulfill({ json: { ok: true, stripe: 'mock' } });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: `Unexpected request: ${path}` } });
  });
  return unexpected;
}

function offer(id, currency = 'USD', inStock = true) {
  return { id, title: `${id} listing`, store: 'Sample shop', price: 20, currency, inStock, isMock: true, source: 'demo_catalog', warnings: ['Sample data, not a live merchant offer.'] };
}

function item(id, name, listing) {
  return {
    id, name, quantity: 1, reason: 'For the trip', purchased: false, owned: false,
    products: [listing], synthesis: { best: listing, totalPrice: listing.price, currency: listing.currency, summary: listing.title, warnings: [] },
  };
}

test('account-service failure leaves planning usable and configured voice discoverable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const unexpected = await mockApi(page, (path) => {
    if (path === '/api/me') return { status: 503, json: { error: 'Account service unavailable' } };
    if (path === '/api/conjure/health') return { json: { integrations: { gemini_live: 'configured', llm: 'not configured' } } };
    return null;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: plannerHeading })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk', exact: true })).toBeVisible();
  await page.getByLabel('Plan prompt').fill('Prepare for a trip');
  await expect(page.getByRole('button', { name: 'Build list', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('Google can be skipped and setup saves an anonymous profile', async ({ page }) => {
  await page.clock.install();
  let saved;
  const unexpected = await mockApi(page, (path, request) => {
    if (path === '/api/me') return { json: { user: null, profile: {}, google: { available: true, connected: false } } };
    if (path === '/api/me/profile') {
      saved = request.postDataJSON();
      return { json: { profile: { ...saved, completedAt: completedProfile.completedAt } } };
    }
    return null;
  });
  await page.goto('/?google=denied');
  await expect(page.getByRole('heading', { name: "Let's get you set up" })).toBeVisible();
  // The account-loading timeout must stop once /me successfully opens setup.
  await page.clock.fastForward(3500);
  await expect(page.getByRole('heading', { name: "Let's get you set up" })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Google access was not granted');
  await page.getByRole('button', { name: 'Skip, just the questions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What do you plan for most?' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: plannerHeading })).toBeVisible();
  expect(saved).toEqual({ focus: null, priority: null, budget: null });
  expect(unexpected).toEqual([]);
});

test('calendar onboarding starts a shared plan, polls prices, and keeps ownership changes', async ({ page }) => {
  const listed = offer('shelter');
  const plan = {
    id: 'calendar-plan', title: 'Weekend expedition', prompt: 'Prepare for weekend camping', category: 'camping', status: 'pricing',
    items: [{ ...item('shelter-item', 'Shelter', listed), products: [], synthesis: null }],
  };
  let saved;
  let created;
  let polls = 0;
  let finishPricing;
  const pricingFinished = new Promise((resolve) => { finishPricing = resolve; });
  const unexpected = await mockApi(page, async (path, request) => {
    if (path === '/api/me') return { json: { user: { name: 'Jordan', email: 'jordan@example.test' }, profile: {}, google: { available: true, connected: true, calendar: true } } };
    if (path === '/api/me/profile') { saved = request.postDataJSON(); return { json: { profile: { ...saved, completedAt: completedProfile.completedAt } } }; }
    if (path === '/api/calendar/suggestions') return { json: { calendar: true, suggestions: [{ id: 'event-1', title: 'Weekend expedition', date: '2026-10-20', daysAway: 2, prompt: plan.prompt, category: 'camping' }] } };
    if (path === '/api/plans' && request.method() === 'POST') { created = request.postDataJSON(); return { json: plan }; }
    if (path === '/api/plans/calendar-plan') {
      polls++;
      await pricingFinished;
      plan.status = 'ready';
      plan.items = [item('shelter-item', 'Shelter', listed)];
      return { json: plan };
    }
    if (path === '/api/plans/calendar-plan/items/shelter-item' && request.method() === 'PATCH') {
      expect(request.postDataJSON()).toEqual({ owned: true });
      plan.items[0].owned = true;
      return { json: plan };
    }
    return null;
  });
  await page.goto('/');
  await page.getByRole('radio', { name: /Outdoors/ }).click();
  await page.getByRole('radio', { name: /Fast shipping/ }).click();
  await page.getByRole('radio', { name: 'Under $100', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Coming up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Weekend expedition/ }).click();
  const open = page.getByRole('button', { name: 'Open Weekend expedition', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Shelter product options', exact: true });
  await expect(dialog).toContainText('No store listings yet.');
  finishPricing();
  await expect(dialog.getByText('shelter listing', { exact: true })).toBeVisible();
  expect(polls).toBeGreaterThan(0);
  expect(saved).toEqual({ focus: 'outdoors', priority: 'speed', budget: 'under-100' });
  expect(created).toEqual({ prompt: plan.prompt, category: 'camping', async: true });
  await dialog.getByRole('button', { name: 'Mark owned', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Mark needed', exact: true })).toBeVisible();
  await expect(dialog.locator('[data-gesture-id="product:shelter-item:shelter"]')).toBeDisabled();
  expect(unexpected).toEqual([]);
});

test('mobile layout retains keyboard inspection and holds unknown-stock or mixed-currency purchases', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem('esper:board', JSON.stringify({ planIds: ['mobile-plan'], marks: { 'usd-item': 'cart', 'cad-item': 'cart' }, trustFloor: 0.5 })));
  const unknown = offer('unknown', 'USD', null);
  const unknownItem = item('unknown-item', 'Mystery supply', unknown);
  unknownItem.synthesis = { best: null, alternatives: [unknown], totalPrice: null, currency: 'USD', warnings: ['Stock and the merchandise subtotal are unknown.'] };
  const plan = {
    id: 'mobile-plan', title: 'Travel essentials', prompt: 'Travel supplies', category: 'custom', status: 'ready',
    items: [item('usd-item', 'US supply', offer('usd')), item('cad-item', 'Canadian supply', offer('cad', 'CAD')), unknownItem],
  };
  const unexpected = await mockApi(page, (path) => path === '/api/plans' ? { json: { plans: [plan] } } : path === '/api/plans/mobile-plan' ? { json: plan } : null);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: plannerHeading })).toBeVisible();
  await page.getByRole('button', { name: /^Cart, 2 items/ }).click();
  const cart = page.getByRole('dialog', { name: 'Cart and checkout', exact: true });
  await cart.getByRole('button', { name: 'Check out $40.00', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Checkout requires a single known currency.');
  await cart.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-group-id="mobile-plan"]').click();
  const inspect = page.locator('[data-gesture-object="item:unknown-item"]');
  await inspect.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Mystery supply product options', exact: true });
  await expect(dialog).toContainText('Stock unknown');
  await expect(dialog.locator('[data-gesture-id="product:unknown-item:unknown"]')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(unexpected).toEqual([]);
});
