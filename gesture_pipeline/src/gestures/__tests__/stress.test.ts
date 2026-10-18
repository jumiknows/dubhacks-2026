import { describe, expect, it } from 'vitest';
import { assessStress, stressCases } from './stressCases';

describe('noise, low update rates and action response budgets', () => {
  for (const fps of [15, 20, 24, 30, 60]) {
    for (const scenario of stressCases(101, fps)) {
      it(scenario.name, () => expect(assessStress(scenario).errors).toEqual([]));
    }
  }
});
