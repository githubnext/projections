/**
 * Moves every known need by as much as the shown plan's need moved (`measured` against what was known for it), for a
 * change that affects every plan alike, such as a longer label. Nothing moves while the shown plan's need was unknown.
 */
export function shiftNeeds(needs: Map<string, number>, shown: string, measured: number): void {
  const known = needs.get(shown)
  if (known === undefined || known === measured) return
  for (const [plan, need] of needs) needs.set(plan, need + measured - known)
}

/**
 * The needs to keep for a new set of plans (`to`), carried from the previous ones (`from`) by `carry`'s key: each new
 * plan gets the need of the first previous plan with its key. Nothing carries (`undefined`) unless a new plan has the
 * key of `shown`, the plan the bar showed.
 */
export function carryNeeds<T>(
  from: readonly T[],
  to: readonly T[],
  shown: T,
  needs: ReadonlyMap<string, number>,
  sign: (plan: T) => string,
  carry: (plan: T) => string,
): Map<string, number> | undefined {
  if (!to.some(plan => carry(plan) === carry(shown))) return undefined
  const byKey = new Map<string, number>()
  for (const plan of from) {
    const need = needs.get(sign(plan))
    if (need !== undefined && !byKey.has(carry(plan))) byKey.set(carry(plan), need)
  }
  const carried = new Map<string, number>()
  for (const plan of to) {
    const need = byKey.get(carry(plan))
    if (need !== undefined) carried.set(sign(plan), need)
  }
  return carried
}
