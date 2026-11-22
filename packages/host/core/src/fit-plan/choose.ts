/** A more spacious plan is chosen again only once the bar is this much wider than that plan needs, so it doesn't flicker. */
export const toolbarHysteresis = 24

/**
 * The room a move from the settled plan (`from`) to a more spacious one (`to`) needs to spare, in pixels. With
 * `from === to` it is how far past its ceiling the settled plan may stay.
 */
export type FitHysteresis<T> = number | ((from: T, to: T) => number)

/** What `chooseFitPlan` chooses from. */
export interface FitChoice<T> {
  /** The plans, most spacious first. */
  plans: readonly T[]
  /** The bar's width. */
  width: number
  /** The index of the settled plan, the one shown before this choice. */
  settled: number
  /** What a plan was measured to need, or `undefined` while it hasn't been. */
  need: (plan: T) => number | undefined
  /** The widest the bar may be for a plan (`undefined`: no limit). */
  ceiling?: (plan: T) => number | undefined
  /** Default `toolbarHysteresis`. */
  hysteresis?: FitHysteresis<T>
  /** Plans to prefer (a person is using the bar); others are chosen only when none of these fits. */
  allowed?: ((plan: T) => boolean) | undefined
}

/**
 * The index of the first plan that fits `width` (preferring plans `allowed` keeps), or of the first not measured yet,
 * to try it. A plan collapses as soon as it stops fitting; a plan more spacious than the settled one must fit with its
 * hysteresis to spare, and a plan whose ceiling the bar is wider than is skipped (the settled one only past its
 * ceiling and its hysteresis). The last plan is the fallback.
 */
export function chooseFitPlan<T>(choice: FitChoice<T>): number {
  const {plans, width, settled, need: needOf, ceiling, hysteresis = toolbarHysteresis, allowed} = choice
  const from = plans[settled]
  const spare = (to: T) => (typeof hysteresis === 'number' ? hysteresis : from === undefined ? 0 : hysteresis(from, to))
  for (const keep of allowed ? [allowed, undefined] : [undefined]) {
    for (const [index, plan] of plans.entries()) {
      if (keep && !keep(plan)) continue
      const need = needOf(plan)
      if (need === undefined) return index
      const limit = ceiling?.(plan)
      if (limit !== undefined && width > limit + (index === settled ? spare(plan) : 0)) continue
      if (need <= width + 0.5 - (index < settled ? spare(plan) : 0)) return index
    }
  }
  return plans.length - 1
}
