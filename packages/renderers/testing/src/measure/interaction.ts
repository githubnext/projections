// Selection, hover and clicks, as a person makes them, and waiting for the latest paint.
import {visible} from './paint.js'

const selectedSelector = '.selected, [aria-pressed="true"], [aria-current="true"], [aria-selected="true"], [data-projections-selected]'

/** Entity IDs the renderer marks as selected, on the entity element or one of its own parts (not a nested entity). */
export function selectedEntities(): string[] {
  const ids = new Set<string>()
  for (const element of document.querySelectorAll(selectedSelector)) {
    const entity = element.closest('[data-entity-id]')
    if (entity) ids.add(entity.getAttribute('data-entity-id')!)
  }
  return [...ids]
}

/** Entity IDs the renderer marks as hovered. */
export function hoveredEntities(): string[] {
  return [
    ...new Set(
      [...document.querySelectorAll('[data-entity-id][data-projections-hovered]')].map(element => element.getAttribute('data-entity-id')!),
    ),
  ]
}

/** Clicks the visible element of an entity at its centre, as a person would. */
export function clickEntity(id: string): boolean {
  const element = [...document.querySelectorAll('[data-entity-id]')].find(
    item => item.getAttribute('data-entity-id') === id && visible(item),
  )
  if (!element) return false
  // A person clicks the entity's own control when it has one (a row's button, a card's link).
  const control =
    [...element.querySelectorAll('button, a[href], [role="button"], [tabindex]')].find(
      item => item.closest('[data-entity-id]') === element && visible(item),
    ) ?? element
  control.scrollIntoView({block: 'nearest', inline: 'nearest'})
  const box = control.getBoundingClientRect()
  const x = box.left + box.width / 2,
    y = box.top + box.height / 2
  const hit = document.elementFromPoint(x, y)
  const target = hit && control.contains(hit) ? hit : control
  dispatchClick(target, x, y)
  return true
}

/** A person's click on `target` at (`x`, `y`): pointer and mouse down and up, then the click (its first, `detail` 1). */
function dispatchClick(target: Element, x: number, y: number): void {
  const init = {bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: globalThis.window}
  target.dispatchEvent(new PointerEvent('pointerdown', {...init, pointerId: 1, isPrimary: true}))
  target.dispatchEvent(new MouseEvent('mousedown', {...init, detail: 1}))
  target.dispatchEvent(new PointerEvent('pointerup', {...init, pointerId: 1, isPrimary: true}))
  target.dispatchEvent(new MouseEvent('mouseup', {...init, detail: 1}))
  target.dispatchEvent(new MouseEvent('click', {...init, detail: 1}))
}

/** A renderer's own controls (as the kit's shell sees them): a click on one isn't a click on the background. */
const controls = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    'button',
    'link',
    'checkbox',
    'switch',
    'radio',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'slider',
    'combobox',
  ].map(role => `[role="${role}"]`),
].join(', ')

/**
 * Clicks the renderer's background, as a person would: the first point of a grid over the viewport whose element is
 * neither an entity (`data-entity-id`) nor a control. False when no background is in view, such as a renderer whose
 * entities cover its whole frame.
 */
export function clickBackground(): boolean {
  const width = document.documentElement.clientWidth
  const height = document.documentElement.clientHeight
  for (let row = 1; row < 16; row++) {
    for (let column = 1; column < 16; column++) {
      const x = (column / 16) * width
      const y = (row / 16) * height
      const hit = document.elementFromPoint(x, y)
      if (!hit || hit.closest('[data-entity-id]') || hit.closest(controls)) continue
      dispatchClick(hit, x, y)
      return true
    }
  }
  return false
}

/** Resolves after two animation frames, so the latest updates are painted. */
export function settle(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}
