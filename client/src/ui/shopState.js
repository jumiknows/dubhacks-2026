export const TONES = {
  owned: "owned",
  purchased: "purchased",
  cart: "cart",
  needed: "needed",
};

export function itemTone(item, marks = {}) {
  const mark = marks[item?.id];
  if (mark === TONES.owned || item?.owned) return TONES.owned;
  if (mark === TONES.purchased || item?.purchased) return TONES.purchased;
  if (mark === TONES.cart) return TONES.cart;
  return TONES.needed;
}

export function toneLabel(tone) {
  if (tone === TONES.owned) return "Owned";
  if (tone === TONES.purchased) return "Purchased";
  if (tone === TONES.cart) return "In cart";
  return "To buy";
}

export function groupTone(items, marks) {
  const tones = items.map((item) => itemTone(item, marks));
  if (!tones.length) return TONES.needed;
  if (tones.every((tone) => tone === TONES.owned)) return TONES.owned;
  if (tones.every((tone) => tone === TONES.purchased || tone === TONES.owned)) return TONES.purchased;
  if (tones.some((tone) => tone === TONES.cart) && tones.every((tone) => tone !== TONES.needed)) return TONES.cart;
  return TONES.needed;
}
