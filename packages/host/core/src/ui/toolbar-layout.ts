import {useMemo} from 'react'
import type {RefObject} from 'react'
import type {ModeForm, PairForm} from './blocks.js'
import {fitWidth, useFitPlan} from './fit-plan.js'

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

/** The slider's minimum width, and the narrower minimum below `narrowToolbar`. */
export const sliderMinimum = {regular: 160, narrow: 120}
export const narrowToolbar = 480
/** In a second row, the slider spans at least this share of the row; a row that can't keep it holds less. */
export const playbackRowShare = 0.8
/**
 * A second row is used only while row 1 stays at least this full; a wider toolbar prefers one row with the pickers
 * merged over two rows with an emptyish first row.
 */
export const firstRowFill = 0.62

// The mode switch is icons only (each mode's name is its tooltip and accessible name) until it collapses to a menu.
const forms: readonly (readonly [PairForm, ModeForm])[] = [
  ['full', 'icons'],
  ['short', 'icons'],
  ['short', 'menu'],
]

const signature = (plan: ToolbarPlan) => `${plan.rows}:${plan.cluster}:${plan.pair}:${plan.mode}:${plan.playback}:${plan.more.join(',')}`

/**
 * The plans the toolbar tries, most spacious first. With a mode region, the first plans centre it on the row in its
 * fullest forms, with every action inline: one row, or (with playback) two, playback alone on row 2, so choosing
 * Animated doesn't move the mode switch under the pointer. Then the mode region follows the start region, and one row
 * is preferred and collapses in priority order while it
 * still fits at the minimums: the pickers become compact triggers, the mode switch (icons only) becomes
 * a dropdown, (with playback) the steps and percent move into the playback group's overflow, the actions move into
 * More one at a time (`actionCollapseOrder`), and finally the steps and percent join them there. Only when one row
 * can't fit even then does playback take a planned second row, with a slider spanning at least 80% of it; row 1
 * then has the width to itself, so it starts again from its most spacious forms and collapses in the same order,
 * finally merging the pickers into one compare button. Row 2 independently keeps the steps and percent inline,
 * in the group's overflow, or in More, whichever keeps its slider at 80%. Without playback the single row continues
 * the same way.
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
    // Two rows while row 1 stays full enough (`firstRowFill`, see `rowCeiling`); then one row with the pickers merged;
    // and two rows with them merged last.
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

/**
 * The plan in `plans` nearest to `plan`: the same one, else the same region forms and placement in another row count
 * (a centred mode region stays centred as playback comes and goes), else the same forms.
 */
function locate(plans: readonly ToolbarPlan[], plan: ToolbarPlan): number {
  const matches = [
    (item: ToolbarPlan) => signature(item) === signature(plan),
    (item: ToolbarPlan) =>
      item.cluster === plan.cluster && item.pair === plan.pair && item.mode === plan.mode && item.more.join() === plan.more.join(),
    (item: ToolbarPlan) => item.pair === plan.pair && item.mode === plan.mode && item.more.join() === plan.more.join(),
    (item: ToolbarPlan) => item.pair === plan.pair && item.mode === plan.mode,
  ]
  for (const match of matches) {
    const index = plans.findIndex(match)
    if (index >= 0) return index
  }
  return 0
}

/**
 * While a person is using a toolbar region (focus is in it, or in a popover it opened), only plans that keep that
 * region's form are preferred, so the control in their hands isn't remounted. `undefined` when nothing is in use.
 */
function lockOf(toolbar: HTMLElement, plan: ToolbarPlan): ((candidate: ToolbarPlan) => boolean) | undefined {
  const document = toolbar.ownerDocument
  const active = document.activeElement
  if (!active || active === document.body || active === toolbar) return undefined
  let anchor: Element | null = toolbar.contains(active) ? active : null
  if (!anchor) {
    const dialog = active.closest('[role="dialog"]')
    if (!dialog || !toolbar.closest('.pj-root')?.contains(dialog)) return undefined
    anchor = dialog.id ? toolbar.querySelector(`[aria-controls="${CSS.escape(dialog.id)}"]`) : null
    // A popover opened from another popover (Settings from More): keep the whole plan.
    if (!anchor) return candidate => signature(candidate) === signature(plan)
  }
  switch (anchor.closest('[data-toolbar-region]')?.getAttribute('data-toolbar-region')) {
    case 'start':
      return candidate => candidate.pair === plan.pair
    case 'mode':
      return candidate => candidate.mode === plan.mode
    case 'playback':
      return candidate => candidate.rows === plan.rows && candidate.playback === plan.playback
    case 'end':
      return candidate => candidate.more.join() === plan.more.join()
    default:
      return undefined
  }
}

/**
 * The widest toolbar a two-row plan suits: one whose row 1, at its minimums, still fills `firstRowFill` of the row
 * (the toolbar's padding and border take 10px). Plans that merge the pickers are the last resort and have no limit,
 * and neither has a row 1 in its fullest forms (the mode region centred, or after the start region), which is the row
 * the other modes show at the same width.
 */
function rowCeiling(toolbar: HTMLElement, plan: ToolbarPlan): number {
  const fullest = plan.pair === 'full' && plan.mode === 'icons' && plan.more.length === 0
  if (plan.rows !== 2 || plan.pair === 'merged' || fullest) return Infinity
  const row = toolbar.querySelector(':scope > .ph-toolbar-row')
  return row ? fitWidth(row) / firstRowFill + 10 : Infinity
}

/**
 * Plans the prebuilt views' toolbar (`toolbarPlans`) with `useFitPlan`: the slider's minimum (`sliderMin`) is 160px,
 * or 120px on a toolbar under 480px; a second row plans for it to span 80% of the row (`sliderFitMin`); and while a person is using a region its form is kept when possible (`lockOf`),
 * so the control in their hands isn't remounted.
 */
export function useToolbarLayout(
  toolbar: RefObject<HTMLElement | null>,
  content: ToolbarContent,
  key: string,
): {plan: ToolbarPlan; sliderMin: number; sliderFitMin: number} {
  const {pair, modes, playback} = content
  const actions = content.actions.join()
  const plans = useMemo(
    () => toolbarPlans({pair, modes, playback, actions: actions ? (actions.split(',') as ToolbarAction[]) : []}),
    [pair, modes, playback, actions],
  )
  const {plan, width} = useFitPlan(toolbar, plans, {key, signature, locate, lock: lockOf, ceiling: rowCeiling})
  const sliderMin = width > 0 && width < narrowToolbar ? sliderMinimum.narrow : sliderMinimum.regular
  // A second row plans for a slider spanning most of the row (the toolbar's padding and border take 10px).
  const sliderFitMin = plan.rows === 2 ? Math.max(sliderMin, Math.ceil(playbackRowShare * (width - 10))) : sliderMin
  return {plan, sliderMin, sliderFitMin}
}
