import test from 'node:test';
import assert from 'node:assert/strict';
import { isPriced, toValued } from '../src/ui/listing.js';

// A board card, comparison request and checkout must agree about incomplete offers.
test('unknown price, stock or currency cannot turn a displayed offer into a payable cart item', () => {
  const offer = { id: 'tent', title: 'Tent', store: 'Store', price: 80, currency: 'USD', inStock: true, isMock: true, source: 'sample' };
  const item = (best, totalPrice = 80, currency = best.currency) => ({ synthesis: { best, totalPrice, currency } });
  assert.equal(isPriced(item(offer)), true);
  for (const best of [{ ...offer, inStock: null }, { ...offer, inStock: false }, { ...offer, currency: null }]) assert.equal(isPriced(item(best)), false);
  for (const total of [null, 0, -1, Infinity, NaN]) assert.equal(isPriced(item(offer, total)), false);
  const scored = toValued({ ...offer, inStock: undefined, currency: null });
  assert.equal(scored.in_stock, false);
  assert.equal(scored.currency, null);
  assert.equal(toValued(offer).in_stock, true);
});
