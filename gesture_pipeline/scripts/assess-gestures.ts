// Reproducible rule-level tuning loop. Does not open a camera, rewrite defaults, or certify physical tracking.
import { defaults, type Config } from '../src/gestures/config';
import { assessStress, stressCases } from '../src/gestures/__tests__/stressCases';

const cases = (start: number) => Array.from({ length: 10 }, (_, i) => [15, 20, 24, 30, 60].flatMap(fps => stressCases(start + i, fps))).flat();
const training = cases(1), heldOut = cases(101);
const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
function assess(config: Config, scenarios = training) {
  const responses: number[] = [];
  const failures: string[] = [];
  for (const scenario of scenarios) {
    const result = assessStress(scenario, config);
    if (result.responseMs !== null) responses.push(result.responseMs);
    if (result.errors.length) failures.push(`${scenario.name}: ${result.errors.join('; ')}`);
  }
  return { failures, responseP95Ms: percentile(responses, 0.95) };
}
const baseline = assess(defaults, heldOut);
console.log(`Synthetic rule assessment: ${heldOut.length} held-out cases, ${heldOut.length - baseline.failures.length} passed, response p95 ${baseline.responseP95Ms.toFixed(1)}ms`);
baseline.failures.slice(0, 12).forEach(failure => console.log(`  ${failure}`));
if (process.argv.includes('--sweep')) {
  const rows: { config: Config; errors: number; p95: number }[] = [];
  for (const releaseMs of [50, 70]) for (const armMs of [50, 70]) for (const minDist of [0.07, 0.09]) {
    const config: Config = { ...defaults, pinch: { ...defaults.pinch, releaseMs }, swipe: { ...defaults.swipe, armMs, minDist } };
    const result = assess(config);
    rows.push({ config, errors: result.failures.length, p95: result.responseP95Ms });
  }
  rows.sort((a, b) => a.errors - b.errors || a.p95 - b.p95);
  console.table(rows.map(row => ({ releaseMs: row.config.pinch.releaseMs, swipeArmMs: row.config.swipe.armMs,
    travel: row.config.swipe.minDist, failures: row.errors, responseP95Ms: row.p95.toFixed(1) })));
  const winner = rows[0];
  const validation = assess(winner.config, heldOut);
  console.log(`Best candidate held-out: ${heldOut.length - validation.failures.length}/${heldOut.length}; settings are suggestions, never applied automatically.`);
}
console.log('Camera accuracy, physical motion-to-screen latency and multi-user validation still require real recordings.');
if (baseline.failures.length) process.exitCode = 1;
