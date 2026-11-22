import {playbackRowShare} from './steps.js'

/**
 * The width the toolbar needs as rendered, every flexible part (the slider) at its minimum, and with `row` (a second
 * row with the steps inline) also the width at which the slider, which grows with the toolbar, spans
 * `playbackRowShare` of the row (the toolbar's content box).
 */
export function requiredWidth(element: HTMLElement, row: boolean): {need: number; rowNeed?: number} {
  const previous = element.style.width
  element.style.width = 'min-content'
  // A centred row's start region is as wide as its half at most: measure what it would take.
  const start = element.querySelector<HTMLElement>(':scope > .phv-toolbar-start')
  const startLimit = start?.style.maxWidth
  if (start) start.style.maxWidth = 'none'
  const style = getComputedStyle(element)
  const frame = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
    (sum, name) => sum + (Number.parseFloat(style[name as 'paddingLeft']) || 0),
    0,
  )
  const width = element.getBoundingClientRect().width
  const centred = centredNeed(element, frame)
  const slider = row ? element.querySelector('.phv-playback .phv-progress')?.getBoundingClientRect().width : undefined
  element.style.width = previous
  if (start) start.style.maxWidth = startLimit ?? ''
  const need = Math.ceil(Math.max(width, centred))
  if (slider === undefined) return {need}
  return {need, rowNeed: Math.ceil((width - slider - playbackRowShare * frame) / (1 - playbackRowShare)) + 1}
}

/**
 * What a centred row needs (`data-cluster="centre"`, see `toolbarGrid`): the mode region, the gaps beside it and twice
 * the wider of the picker and the actions, so the mode region stays at the centre. Its halves shrink to nothing under
 * `min-content`, so the regions are measured at their own widths.
 */
function centredNeed(element: HTMLElement, frame: number): number {
  if (element.getAttribute('data-cluster') !== 'centre') return 0
  const width = (selector: string) => element.querySelector(`:scope > ${selector}`)?.getBoundingClientRect().width ?? 0
  const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0
  return frame + width('.phv-toolbar-mode') + 2 * gap + 2 * Math.max(width('.phv-toolbar-start'), width('.phv-toolbar-end'))
}
