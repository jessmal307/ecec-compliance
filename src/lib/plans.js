export const PLAN_RANK = { core: 0, plus: 1, pro: 2 }

export const FEATURE_MIN_PLAN = { forms: 'plus' }

export function can(org, feature) {
  const minPlan = FEATURE_MIN_PLAN[feature]
  if (!minPlan) return false
  const plan = typeof org === 'string' ? org : org?.plan
  return (PLAN_RANK[plan] ?? 0) >= PLAN_RANK[minPlan]
}
