import type {ModeForm, PairForm} from './blocks.js'

/** A toolbar action that moves into More when the row is short of room, in the order they move. */
export type ToolbarAction = 'varied' | 'zoom' | 'info' | 'fullscreen' | 'filter'
/**
 * The order actions move into More: the varied count (informational) first, then the widest and least used, Filter
 * last. Settings always stays in the row.
 */
export const actionCollapseOrder: readonly ToolbarAction[] = ['varied', 'zoom', 'info', 'fullscreen', 'filter']

/**
 * One way to lay out the prebuilt views' toolbar: one row, or two planned rows (row 1: the pair picker, mode, view
 * chip and actions; row 2: the playback group with a full-width slider), and the form each region takes.
 */
export interface ToolbarPlan {
  rows: 1 | 2
  /**
   * Where the mode region (the mode and scope switches) sits: centred on the whole row, with the start region at the
   * row's start and the actions at its end; or after the start region, the row's free space between it and the actions.
   */
  cluster: 'centre' | 'start'
  /** The pair picker: two selects, two compact triggers, or one compare button. */
  pair: PairForm
  /** The mode switch: icons and labels, icons only, or one dropdown button. */
  mode: ModeForm
  /**
   * Playback: everything inline; the steps and percent in the group's own overflow (`compact`); or only the play
   * button and slider, with the steps and percent in More (`minimal`).
   */
  playback: 'full' | 'compact' | 'minimal'
  /** The actions in More, in `actionCollapseOrder`; the rest (and Settings) stay in the row. */
  more: readonly ToolbarAction[]
}

/** Which toolbar regions are present and can change form. */
export interface ToolbarContent {
  /** The start region draws the pair picker in any form (`toolbarStart` is a function). */
  pair: boolean
  /** The mode switch is shown. */
  modes: boolean
  /** The playback group is shown, so a second row is possible. */
  playback: boolean
  /** The actions present, which can move into More one at a time. */
  actions: readonly ToolbarAction[]
}

// The mode switch is icons only (each mode's name is its tooltip and accessible name) until it collapses to a menu.
const forms: readonly (readonly [PairForm, ModeForm])[] = [
  ['full', 'icons'],
  ['short', 'icons'],
  ['short', 'menu'],
]

/** A plan's identity. */
export const signature = (plan: ToolbarPlan) =>
  `${plan.rows}:${plan.cluster}:${plan.pair}:${plan.mode}:${plan.playback}:${plan.more.join(',')}`

/**
 * The plans the toolbar tries, most spacious first. With a mode region, the first plans centre it on the row in its
 * fullest forms, with every action inline: one row, or (with playback) two, playback alone on row 2, so choosing
 * Animated doesn't move the mode switch under the pointer; then (with playback) the same two rows with the mode region
 * after the start region. Then one row is preferred and collapses in priority order while it still fits at the
 * minimums: the pickers become compact triggers, the mode switch (icons only) becomes a dropdown, (with playback)
 * the steps and percent move into the playback group's overflow, the actions move into More one at a time
 * (`actionCollapseOrder`), and finally the steps and percent join them there. Only when one row can't fit even then
 * does playback take a planned second row, with a slider spanning at least 80% of it; row 1 then has the width to
 * itself, so it starts again from its most spacious forms and collapses in the same order, finally merging the
 * pickers into one compare button. Row 2 independently keeps the steps and percent inline, in the group's overflow,
 * or in More, whichever keeps its slider at 80%. Without playback the single row continues the same way.
 */
export function toolbarPlans(content: ToolbarContent): ToolbarPlan[] {
  const actions = actionCollapseOrder.filter(action => content.actions.includes(action))
  const moved = (count: number) => actions.slice(0, count)
  // Row 1's configurations, most spacious first: the forms with every action inline, then actions into More, then
  // the merged pickers.
  const row: {pair: PairForm; mode: ModeForm; more: readonly ToolbarAction[]}[] = [
    ...forms.map(([pair, mode]) => ({pair, mode, more: moved(0)})),
    ...actions.map((_, index) => ({pair: 'short' as const, mode: 'menu' as const, more: moved(index + 1)})),
    {pair: 'merged', mode: 'menu', more: moved(actions.length)},
  ]
  const plans: ToolbarPlan[] = []
  const playbacks = ['full', 'compact', 'minimal'] as const
  const cluster = 'start' as const
  if (content.modes) {
    const centred = {cluster: 'centre', pair: 'full', mode: 'icons', more: []} as const
    // With playback, the same two rows with the mode region after the start region follow, before anything collapses.
    if (content.playback)
      for (const placement of ['centre', 'start'] as const)
        plans.push(...playbacks.map(playback => ({rows: 2 as const, ...centred, cluster: placement, playback})))
    else plans.push({rows: 1, ...centred, playback: 'full'})
  }
  if (content.playback) {
    for (const [pair, mode] of forms) plans.push({rows: 1, cluster, pair, mode, playback: 'full', more: []})
    for (let count = 0; count <= actions.length; count++)
      plans.push({rows: 1, cluster, pair: 'short', mode: 'menu', playback: 'compact', more: moved(count)})
    plans.push({rows: 1, cluster, pair: 'short', mode: 'menu', playback: 'minimal', more: moved(actions.length)})
    const two = (config: (typeof row)[number]) => playbacks.map(playback => ({rows: 2 as const, cluster, ...config, playback}))
    // Two rows while row 1 stays full enough (`firstRowFill`, see `rowCeiling` in toolbar-layout.ts); then one row
    // with the pickers merged; and two rows with them merged last.
    plans.push(...row.filter(config => config.pair !== 'merged').flatMap(two))
    for (const playback of ['compact', 'minimal'] as const)
      plans.push({rows: 1, cluster, pair: 'merged', mode: 'menu', playback, more: moved(actions.length)})
    plans.push(...row.filter(config => config.pair === 'merged').flatMap(two))
  } else {
    for (const config of row) plans.push({rows: 1, cluster, ...config, playback: 'full'})
  }
  const seen = new Set<string>()
  return plans
    .map(plan => ({
      ...plan,
      pair: content.pair ? plan.pair : 'full',
      mode: content.modes ? plan.mode : 'labels',
    }))
    .filter(plan => {
      const key = signature(plan)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
