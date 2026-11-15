import {playbackRowShare} from './steps.js'

/**
 * The width the toolbar needs as rendered, every flexible part (the slider) at its minimum, and with `row` (a second
 * row with the steps inline) also the width at which the slider, which grows with the toolbar, spans
 * `playbackRowShare` of the row (the toolbar's content box).
 */
export function requiredWidth(element: HTMLElement, row: boolean): {need: number; rowNeed?: number} {
  const previous = element.style.width
  element.style.width = 'min-content'
  const width = element.getBoundingClientRect().width
  const slider = row ? element.querySelector('.phv-playback .phv-progress')?.getBoundingClientRect().width : undefined
  element.style.width = previous
  const need = Math.ceil(width)
  if (slider === undefined) return {need}
  const style = getComputedStyle(element)
  const frame = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
    (sum, name) => sum + (parseFloat(style[name as 'paddingLeft']) || 0),
    0,
  )
  return {need, rowNeed: Math.ceil((width - slider - playbackRowShare * frame) / (1 - playbackRowShare)) + 1}
}
