const plans = new Map();

export function savePlan(plan) {
  plans.set(plan.id, plan);
  return plan;
}

export function getPlan(id) {
  return plans.get(id) || null;
}
