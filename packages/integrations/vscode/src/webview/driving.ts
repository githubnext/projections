// Driving the page as a person would, and reading where things are drawn, for tests (the `elements`, `press`, `click`,
// `boxes` and `anchors` controls).
import type {InspectorHandle} from '@githubnext/projections-inspector/mount'

/** The first element matching `selector` (and containing `text`), for tests driving the page. */
function find(selector: string, text?: string): HTMLElement {
  const target = [...document.querySelectorAll<HTMLElement>(selector)].find(
    element => text === undefined || element.textContent.includes(text),
  )
  if (!target) throw new Error(`Nothing matches ${selector}${text === undefined ? '' : ` with ${text}`}`)
  return target
}

/** The page's elements matching `selector`, as text and an attribute, for tests driving the page. */
export function elements(selector: string, attribute?: string) {
  return [...document.querySelectorAll(selector)].slice(0, 200).map(element => ({
    text: element.textContent.trim().slice(0, 500),
    ...(attribute ? {value: element.getAttribute(attribute)} : {}),
  }))
}

/** Focuses the first element matching `selector` (and containing `text`) and presses `key` on it. */
export function press(selector: string, text: string | undefined, key: string) {
  const target = find(selector, text)
  target.focus()
  const init = {key, bubbles: true, cancelable: true, composed: true}
  target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
}

/** Clicks the first element matching `selector` (and containing `text`). */
export function click(selector: string, text: string | undefined) {
  const target = find(selector, text)
  // A mouse press, as a person's: menus and selects open on pointer events, not on click alone.
  const init = {bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse', isPrimary: true}
  target.dispatchEvent(new PointerEvent('pointerdown', init))
  target.dispatchEvent(new MouseEvent('mousedown', init))
  target.dispatchEvent(new PointerEvent('pointerup', init))
  target.dispatchEvent(new MouseEvent('mouseup', init))
  target.click()
}

/** The page's elements matching `selector`: their boxes, left and top border widths and radius, in page coordinates. */
export function boxes(selector: string) {
  return [...document.querySelectorAll(selector)].map(element => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      borderLeft: style.borderLeftWidth,
      borderTop: style.borderTopWidth,
      radius: style.borderRadius,
    }
  })
}

/**
 * Where the presented changes are drawn, and the frame they are drawn in. Renderers report where hovered and selected
 * entities are drawn: each changed entity is hovered in turn (hovering never scrolls the stage) and its anchor read
 * once reported.
 */
export async function anchors(inspector: InspectorHandle) {
  const frame = document.querySelector('.phv-root iframe, #root iframe')?.getBoundingClientRect()
  const rows = (inspector.view()?.rows ?? []).filter(row => row.collection === 'entities' && row.status && row.status !== 'unchanged')
  const found = []
  for (const {id, step} of rows) {
    inspector.view()?.hover(id)
    let anchor = null
    for (let waited = 0; waited < 2000 && !anchor; waited += 100) {
      await new Promise(resolve => setTimeout(resolve, 100))
      anchor = inspector.view()?.anchorFor(id) ?? null
    }
    found.push({id, step: step ?? null, anchor})
  }
  inspector.view()?.hover(null)
  return {frame: frame ? {x: frame.x, y: frame.y, width: frame.width, height: frame.height} : null, anchors: found}
}
