const plans = new Map();
const owners = new Map();

export function savePlan(plan, session) {
  plans.set(plan.id, plan);
  if (session) owners.set(plan.id, { sessionId: session.id, accountId: session.accountId });
  return plan;
}

export function getPlan(id) {
  return plans.get(id) || null;
}

export function listPlans(session) {
  if (!session) return [];
  return [...plans.values()].filter((plan) => {
    const owner = owners.get(plan.id);
    return owner && (owner.sessionId === session.id || (session.accountId && owner.accountId === session.accountId));
  }).reverse();
}
