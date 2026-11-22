/** The expanded filter field's width (`pj:w-56`) and the button it replaces. */
const filterFieldWidth = 224
const filterButtonWidth = 32

/** The room a centred row's end half has beyond the actions in it: the half's width less theirs. */
function endRoom(toolbar: HTMLElement): number {
  const mode = toolbar.querySelector('[data-toolbar-region="mode"]')
  const end = toolbar.querySelector('[data-toolbar-region="end"]')
  if (!mode || !end?.parentElement) return 0
  const gap = Number.parseFloat(getComputedStyle(end.parentElement).columnGap) || 0
  const actions = end.getBoundingClientRect()
  return actions.right - mode.getBoundingClientRect().right - gap - actions.width
}

/**
 * Whether the filter can expand in the toolbar's first row: only when the row's flexible room (the spacer and, with
 * playback in the row, the slider beyond its minimum) can take the field, so opening it never makes the row re-plan and
 * move the Filter block while it is in use; otherwise it opens in a popover. In a centred row, the room is what the end
 * half holds beyond the actions, so the mode region stays centred.
 */
export function filterFitsRow(toolbar: HTMLElement, plan: {centred: boolean; sliderMin: number}): boolean {
  if (plan.centred) return endRoom(toolbar) >= filterFieldWidth - filterButtonWidth
  const row = toolbar.querySelector(':scope > .ph-toolbar-row')
  const width = (selector: string) => row?.querySelector(`:scope > ${selector}`)?.getBoundingClientRect().width ?? 0
  const slider = row?.querySelector(':scope > [data-toolbar-region="playback"] .ph-progress')?.getBoundingClientRect().width
  const spare = width('[data-fit-min="0"]') + (slider === undefined ? 0 : Math.max(0, slider - plan.sliderMin))
  return spare >= filterFieldWidth - filterButtonWidth
}
