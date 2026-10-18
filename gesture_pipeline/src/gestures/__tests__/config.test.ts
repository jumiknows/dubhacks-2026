import { afterEach, describe, expect, it } from 'vitest';
import { config, defaults, normalizeConfig, resetConfig, setPath } from '../config';

afterEach(() => resetConfig());
describe('configuration validation', () => {
  it('ignores unknown fields, non-finite values and incompatible types', () => {
    const result = normalizeConfig({ pinch: { on: NaN, off: '0.8' }, mp: { numHands: 100 }, camera: { fps: Infinity }, strange: 100 });
    expect(result.pinch).toEqual(defaults.pinch);
    expect(result.mp.numHands).toBe(2);
    expect(result.camera.fps).toBe(30);
    expect('strange' in result).toBe(false);
  });
  it('repairs invalid hysteresis and mapping pairs on load', () => {
    const result = normalizeConfig({ pinch: { on: 0.5, off: 0.2 }, swipe: { on: 0.8, off: 0.3 }, mapping: { boxLeft: 0.8, boxRight: 0.2 } });
    expect(result.pinch.on).toBeLessThan(result.pinch.off);
    expect(result.swipe.on).toBeLessThan(result.swipe.off);
    expect(result.mapping.boxRight - result.mapping.boxLeft).toBeGreaterThan(0.1);
  });
  it('rejects unsafe live paths and inverted pairs while applying valid tuning', () => {
    setPath('__proto__.polluted', 1); setPath('pinch.off', 0.1); setPath('smoothing.beta', NaN);
    expect(config.pinch.off).toBe(defaults.pinch.off);
    expect(config.smoothing.beta).toBe(defaults.smoothing.beta);
    setPath('smoothing.beta', 0.02); expect(config.smoothing.beta).toBe(0.02);
    setPath('camera.fps', 1000); expect(config.camera.fps).toBe(60);
  });
});
