import {useMemo} from 'react'
import type {RefObject} from 'react'
import {fitWidth, useFitPlan} from './fit-plan.js'
import {signature, toolbarPlans} from './toolbar-plans.js'
import type {ToolbarAction, ToolbarContent, ToolbarPlan} from './toolbar-plans.js'

export {actionCollapseOrder, toolbarPlans} from './toolbar-plans.js'
export type {ToolbarAction, ToolbarContent, ToolbarPlan} from './toolbar-plans.js'

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
