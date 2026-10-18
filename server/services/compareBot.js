/**
 * OWNER: Pairwise compare
 * Two listings that already have bang_per_buck, relevancy, and trust.
 * Python applies score = initial_value × trust_multiplier.
 */

import { marketPost } from "./marketClient.js";

export async function compareItems(left, right, trustFloor = 0.5) {
  try {
    return await post("/market/compare", {
      left,
      right,
      trust_floor: trustFloor,
    });
  } catch {
    return localCompare(left, right, trustFloor);
  }
}

function finish(item, trustFloor) {
  const bang = Number(item.bang_per_buck) || 0;
  const relevancy = item.relevancy == null ? 1 : Number(item.relevancy);
  const trust = Number(item.trust) || 0;
  const floor = Math.min(1, Math.max(0, trustFloor));
  const mult = floor + (1 - floor) * Math.min(1, Math.max(0, trust));
  const initial = bang * relevancy;
  return {
    ...item,
    in_stock: item.in_stock ?? item.inStock ?? false,
    initial_value: round4(initial),
    trust_multiplier: round4(mult),
    score: round4(initial * mult),
  };
}

function localCompare(left, right, trustFloor) {
  const a = finish(left, trustFloor);
  const b = finish(right, trustFloor);
  const axes = [
    axis("bang_per_buck", a.bang_per_buck, b.bang_per_buck, "higher is more utility per landed dollar"),
    axis("relevancy", a.relevancy, b.relevancy, "higher matches the prompt more closely"),
    axis("initial_value", a.initial_value, b.initial_value, "bang per buck × relevancy"),
    axis("trust", a.trust, b.trust, "review/seller quality before the floor"),
    axis("trust_multiplier", a.trust_multiplier, b.trust_multiplier, `floor ${trustFloor}`),
    axis("score", a.score, b.score, "headline"),
  ];
  const reasons = [
    `${a.title || a.id}: score ${a.score}`,
    `${b.title || b.id}: score ${b.score}`,
  ];
  let pick = null;
  let split_decision = false;
  if (!a.in_stock && b.in_stock) pick = "right";
  else if (a.in_stock && !b.in_stock) pick = "left";
  else if (Math.abs(a.score - b.score) < 0.05) split_decision = true;
  else pick = a.score > b.score ? "left" : "right";
  return { left: a, right: b, axes, pick, split_decision, reasons, trust_floor: trustFloor, method: "bang_per_buck * relevancy * trust_multiplier" };
}

function axis(name, left, right, note) {
  const lv = Number(left) || 0;
  const rv = Number(right) || 0;
  let winner = null;
  if (Math.abs(lv - rv) >= 0.05) winner = lv > rv ? "left" : "right";
  return { name, left: round4(lv), right: round4(rv), winner, note };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

async function post(path, body) {
  return marketPost(path, body);
}
