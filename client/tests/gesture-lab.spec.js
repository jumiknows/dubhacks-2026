import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const apiUrl = '/@fs/' + fileURLToPath(new URL('../../gesture_pipeline/src/gestures/index.ts', import.meta.url)).replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
  await page.goto('/gesture-lab');
  await expect(page.getByRole('heading', { name: 'Objects with more beneath.' })).toBeVisible();
  await page.evaluate(async apiUrl => {
    const api = await import(apiUrl);
    window.labEvents = [];
    api.gestureBus.on('*', e => window.labEvents.push(e));
  }, apiUrl);
});
const object = (page, id) => page.locator(`[data-gesture-object="${id}"]`);
async function replay(page, name) {
  const button = page.getByRole('button', { name });
  await button.click();
  await expect(button).toBeEnabled({ timeout: 10000 });
  await expect(page.locator('.lab-error')).toHaveCount(0);
}
test('landmark replays expand four grouped components, restore and compare original values', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await replay(page, 'Replay expand');
  await expect(object(page, 'alpine')).toHaveAttribute('data-gesture-kind', 'group');
  await expect(object(page, 'alpine').locator('[data-gesture-kind="component"]')).toHaveCount(4);
  await expect(object(page, 'camp')).toHaveAttribute('data-gesture-kind', 'original');
  const groupIds = await object(page, 'alpine').locator('[data-gesture-kind="component"]').evaluateAll(nodes => nodes.map(n => n.dataset.gestureGroup));
  expect(new Set(groupIds)).toEqual(new Set(['alpine']));
  await replay(page, 'Replay collapse');
  await expect(object(page, 'alpine')).toHaveAttribute('data-gesture-kind', 'original');
  await expect(object(page, 'alpine').locator('[data-gesture-kind="component"]')).toHaveCount(0);
  await replay(page, 'Replay compare');
  const comparison = page.getByTestId('comparison');
  await expect(comparison).toBeVisible();
  await expect(comparison.getByRole('cell', { name: '850 g', exact: true })).toBeVisible();
  await expect(comparison.getByRole('cell', { name: '1650 g', exact: true })).toBeVisible();
  await expect(comparison.locator('.lab-verdict strong')).toHaveText('Alpine 500');
  await comparison.getByRole('combobox').selectOption('price');
  await expect(comparison.locator('.lab-verdict strong')).toHaveText('Camp 300');
  const events = await page.evaluate(() => window.labEvents);
  expect(events.filter(e => ['expand', 'collapse', 'compare'].includes(e.type)).map(e => e.type)).toEqual(['expand', 'collapse', 'compare']);
  expect(events.filter(e => ['expand', 'collapse', 'compare'].includes(e.type)).every(e => e.source === 'replay')).toBe(true);
  expect(events.filter(e => ['reveal', 'dismiss', 'scroll', 'select', 'drag_start'].includes(e.type))).toEqual([]);
  expect(errors).toEqual([]);
});
test('label calibration retains all three interactions', async ({ page }) => {
  await page.getByLabel('Swap left/right labels').check();
  await replay(page, 'Replay expand'); await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'true');
  await replay(page, 'Replay collapse'); await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  await replay(page, 'Replay compare'); await expect(page.getByTestId('comparison')).toBeVisible();
});
test('one moving hand cannot rip an object; two hands on separate groups cannot collapse it', async ({ page }) => {
  await page.evaluate(async () => {
    const { pointOn, replayMotion } = await import('/src/gesture-lab/replay.js');
    const root = document.querySelector('[data-gesture-object="alpine"]');
    const from = [pointOn(root, .22, .58), pointOn(root, .78, .58)];
    await replayMotion(from, [{ x: from[0].x - .1, y: from[0].y }, from[1]], new AbortController().signal);
  });
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  await replay(page, 'Replay expand');
  // Create another expanded original by using the actual coordinator, not editing React state.
  await page.evaluate(async () => {
    const { pointOn, replayMotion } = await import('/src/gesture-lab/replay.js');
    const root = document.querySelector('[data-gesture-object="camp"]');
    const from = [pointOn(root, .22, .58), pointOn(root, .78, .58)];
    await replayMotion(from, [{ x: from[0].x - .1, y: from[0].y }, { x: from[1].x + .1, y: from[1].y }], new AbortController().signal);
  });
  await expect(object(page, 'camp')).toHaveAttribute('data-expanded', 'true');
  // Horizontal inward motion on children is never a comparison.
  await page.evaluate(async () => {
    const { pointOn, replayMotion } = await import('/src/gesture-lab/replay.js');
    const from = ['alpine:warmth', 'camp:warmth'].map(id => pointOn(document.querySelector(`[data-gesture-object="${id}"]`)));
    const mid = (from[0].x + from[1].x) / 2;
    await replayMotion(from, [{ x: mid - .02, y: from[0].y }, { x: mid + .02, y: from[1].y }], new AbortController().signal);
  });
  await expect(page.getByTestId('comparison')).toHaveCount(0);
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'true');
  await expect(object(page, 'camp')).toHaveAttribute('data-expanded', 'true');
});
test('ordinary pinches and drags run concurrently with independent hand identities', async ({ page }) => {
  await page.evaluate(async apiUrl => {
    const { gestures } = await import(apiUrl);
    const { landmarkHand } = await import('/src/gesture-lab/replay.js');
    gestures.stop();
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;inset:100px;z-index:1000;display:flex;gap:100px;background:#222';
    stage.innerHTML = '<div data-gesture-id="left-test" data-gesture-draggable style="flex:1"></div><div data-gesture-id="right-test" data-gesture-draggable style="flex:1"></div>';
    document.body.append(stage);
    let t = performance.now();
    const frame = (l, r, closed = false, reverse = false) => {
      t += 33;
      const hands = [landmarkHand(l, closed, 'Left'), landmarkHand(r, closed, 'Right')];
      gestures.processFrame({ t, videoW: 640, videoH: 480, hands: reverse ? hands.reverse() : hands }, 0, 0, 'replay');
    };
    const l = { x: .25, y: .5 }, r = { x: .75, y: .5 };
    for (let i = 0; i < 10; i++) frame(l, r, false, !!(i % 2));
    for (let i = 0; i < 8; i++) frame(l, r, true, !!(i % 2));
    for (let i = 0; i < 8; i++) frame({ x: l.x + .008 * i, y: l.y }, { x: r.x - .008 * i, y: r.y }, true, !!(i % 2));
    for (let i = 0; i < 5; i++) frame(l, r, false);
    stage.remove(); gestures.stop();
  }, apiUrl);
  const events = await page.evaluate(() => window.labEvents);
  for (const id of ['left', 'right']) {
    expect(events.some(e => e.type === 'pointer_down' && e.hand_id === id && e.target_id === `${id}-test`)).toBe(true);
    expect(events.some(e => e.type === 'drag_start' && e.hand_id === id && e.target_id === `${id}-test`)).toBe(true);
    expect(events.some(e => e.type === 'drop' && e.hand_id === id && e.target_id === `${id}-test`)).toBe(true);
  }
});
test('reset interrupts a replay and leaves both originals intact', async ({ page }) => {
  await page.getByRole('button', { name: 'Replay expand' }).click();
  await page.getByRole('button', { name: 'Reset objects' }).click();
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Replay expand' })).toBeEnabled();
  await replay(page, 'Replay compare');
  await expect(page.getByTestId('comparison')).toBeVisible();
});
test('loss of one hand cancels only its drag while the other finishes', async ({ page }) => {
  await page.evaluate(async apiUrl => {
    const { gestures } = await import(apiUrl);
    const { landmarkHand } = await import('/src/gesture-lab/replay.js');
    gestures.stop();
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;inset:100px;z-index:1000;display:flex;gap:100px;background:#222';
    stage.innerHTML = '<div data-gesture-id="left-test" data-gesture-draggable style="flex:1"></div><div data-gesture-id="right-test" data-gesture-draggable style="flex:1"></div>';
    document.body.append(stage);
    let t = performance.now();
    const frame = (l, r, closed = true) => {
      t += 33;
      const hands = [l && landmarkHand(l, closed, 'Left'), landmarkHand(r, closed, 'Right')].filter(Boolean);
      gestures.processFrame({ t, videoW: 640, videoH: 480, hands }, 0, 0, 'replay');
    };
    const l = { x: .25, y: .5 }, r = { x: .75, y: .5 };
    for (let i = 0; i < 10; i++) frame(l, r, false);
    for (let i = 0; i < 8; i++) frame(l, r);
    for (let i = 0; i < 8; i++) frame({ x: .25 + .008 * i, y: .5 }, { x: .75 - .008 * i, y: .5 });
    for (let i = 0; i < 12; i++) frame(null, { x: .69 - .004 * i, y: .5 });
    for (let i = 0; i < 5; i++) frame(null, { x: .646, y: .5 }, false);
    stage.remove(); gestures.stop();
  }, apiUrl);
  const events = await page.evaluate(() => window.labEvents);
  expect(events.some(e => e.type === 'cancel' && e.hand_id === 'left' && e.target_id === 'left-test')).toBe(true);
  expect(events.some(e => e.type === 'drop' && e.hand_id === 'left')).toBe(false);
  expect(events.some(e => e.type === 'drop' && e.hand_id === 'right' && e.target_id === 'right-test')).toBe(true);
});
test('Escape cancels paired feedback and blocks a held pinch from restarting it', async ({ page }) => {
  const held = await page.evaluate(async () => {
    const { landmarkHand, pointOn } = await import('/src/gesture-lab/replay.js');
    const root = document.querySelector('[data-gesture-object="alpine"]');
    return [pointOn(root, .22, .58), pointOn(root, .78, .58)].map((p, i) => ({ open: landmarkHand(p, false, i ? 'Right' : 'Left'), closed: landmarkHand(p, true, i ? 'Right' : 'Left') }));
  });
  const clock = await page.evaluate(async ({ apiUrl, held }) => {
    const { gestures } = await import(apiUrl);
    gestures.stop(); let t = performance.now();
    for (let i = 0; i < 15; i++) { t += 33; gestures.processFrame({ t, videoW: 640, videoH: 480, hands: held.map(h => i < 10 ? h.open : h.closed) }, 0, 0, 'replay'); }
    return t;
  }, { apiUrl, held });
  await expect(page.locator('.lab-feedback')).toContainText('expand');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lab-feedback')).not.toContainText('expand');
  await page.evaluate(async ({ apiUrl, clock }) => {
    const { gestures } = await import(apiUrl);
    const { landmarkHand, pointOn } = await import('/src/gesture-lab/replay.js');
    const root = document.querySelector('[data-gesture-object="alpine"]');
    const from = [pointOn(root, .22, .58), pointOn(root, .78, .58)];
    for (let i = 0; i < 20; i++) gestures.processFrame({ t: clock + (i + 1) * 33, videoW: 640, videoH: 480,
      hands: from.map((p, h) => landmarkHand({ x: p.x + (h ? 1 : -1) * i * .006, y: p.y }, true, h ? 'Right' : 'Left')) }, 0, 0, 'replay');
  }, { apiUrl, clock });
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  const events = await page.evaluate(() => window.labEvents);
  expect(events.some(e => e.type === 'bimanual_cancel')).toBe(true);
  expect(events.filter(e => e.type === 'bimanual_start')).toHaveLength(1);
  expect(events.filter(e => ['expand', 'reveal', 'dismiss', 'scroll'].includes(e.type))).toEqual([]);
});
for (const viewport of [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) test(`all three gestures work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await replay(page, 'Replay expand');
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'true');
  await replay(page, 'Replay collapse');
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  await replay(page, 'Replay compare');
  await expect(page.getByTestId('comparison')).toBeVisible();
});
test('camera model initializes in its worker and stops cleanly (synthetic video, no physical camera)', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.locator('.lab-local')).toContainText('LIVE', { timeout: 45000 });
  const status = await page.evaluate(async apiUrl => (await import(apiUrl)).gestures.getStatus(), apiUrl);
  expect(status.backend).toBe('worker');
  expect(status.camera).toBe('on');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.lab-local')).toContainText('Camera off');
});
test('main app links directly to spawned, visible test objects without a backend', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Test gestures · spawn test objects' }).click();
  await expect(object(page, 'alpine')).toBeVisible();
  await page.getByRole('button', { name: 'Clear objects', exact: true }).click();
  await expect(object(page, 'alpine')).toHaveCount(0);
  await page.getByRole('button', { name: 'Spawn primary object', exact: true }).click();
  await expect(object(page, 'alpine')).toHaveAttribute('data-gesture-kind', 'original');
  await page.goto('/gesture-lab/');
  await expect(object(page, 'alpine')).toBeVisible();
  await page.screenshot({ path: 'test-results/gesture-lab-ready.png', fullPage: true });
});
test('all feature replays score real scene effects without claiming live accuracy', async ({ page }) => {
  test.setTimeout(120000);
  const run = page.getByRole('button', { name: 'Run all feature replays', exact: true });
  await run.click();
  await expect(run).toBeEnabled({ timeout: 100000 });
  await expect(page.locator('.lab-error')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export session JSON' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let body = ''; for await (const chunk of stream) body += chunk;
  const report = JSON.parse(body);
  expect(report.results).toHaveLength(14);
  expect(report.results.map(r => [r.spec.id, r.outcome, r.missed, r.duplicates, r.unexpected.map(e => e.type), r.failedEffects])).toEqual(report.results.map(r => [r.spec.id, 'pass', 0, 0, [], 0]));
  expect(report.results.every(r => r.source === 'replay')).toBe(true);
  await expect(page.getByRole('region', { name: 'Feature assessment' })).toContainText('Live accuracy: not measured yet');
});
test('a real model trial records frames but a mouse click cannot pass camera accuracy', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByLabel('Test feature', { exact: true }).selectOption('click');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.locator('.lab-local')).toContainText('LIVE', { timeout: 45000 });
  await page.getByRole('button', { name: 'Begin live trial', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('[data-trial-frames]').getAttribute('data-trial-frames'))).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Select item', exact: true }).click();
  await expect(page.locator('[data-click-count]')).toHaveAttribute('data-click-count', '1');
  await page.getByRole('button', { name: 'Finish trial', exact: true }).click();
  await expect(page.getByTestId('trial-result')).toHaveAttribute('data-outcome', 'fail');
  await expect(page.getByTestId('trial-result')).toContainText('1 missed expected actions');
  await expect(page.getByRole('region', { name: 'Feature assessment' })).toContainText('0/1 live trials passed');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});


test('closed fists cannot trigger paired object actions', async ({ page }) => {
  await page.evaluate(async () => {
    const { pointOn, replayMotion } = await import('/src/gesture-lab/replay.js');
    const root = document.querySelector('[data-gesture-object="alpine"]');
    const from = [pointOn(root, .22, .58), pointOn(root, .78, .58)];
    await replayMotion(from, [{ x: from[0].x - .1, y: from[0].y }, { x: from[1].x + .1, y: from[1].y }], new AbortController().signal, 'fist');
  });
  const events = await page.evaluate(() => window.labEvents);
  expect(events.filter(e => ['expand', 'collapse', 'compare', 'bimanual_start'].includes(e.type))).toEqual([]);
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'false');
  await replay(page, 'Replay expand');
  await expect(object(page, 'alpine')).toHaveAttribute('data-expanded', 'true');
});
