import type {KeyboardEvent} from 'react'

/** A key handler that runs `action` on Enter or Space, as a button does. */
export const activateOnKey =
  (action: () => void) =>
  (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

/** The moves arrows, Home and End make in a menu of `length` items, wrapping at its ends. */
const menuMoves = new Map<string, (index: number, length: number) => number>([
  ['ArrowDown', (index, length) => (index + 1) % length],
  ['ArrowUp', (index, length) => (index - 1 + length) % length],
  ['Home', () => 0],
  ['End', (_, length) => length - 1],
])

/**
 * The menu item a key moves focus to from `index`: arrows, Home and End move, and a letter jumps to the next item
 * starting with it. Undefined when the key moves nowhere.
 */
export function menuTarget(key: string, items: readonly HTMLElement[], index: number): number | undefined {
  const move = menuMoves.get(key)
  if (move) return move(index, items.length)
  if (key.length !== 1 || !/\S/u.test(key)) return undefined
  const from = items.slice(index + 1).concat(items.slice(0, index + 1))
  const found = from.find(item => item.textContent?.trim().toLowerCase().startsWith(key.toLowerCase()))
  return found ? items.indexOf(found) : undefined
}

/** The item a menu focuses when it opens: its checked item, else its first (after a back row). */
export const openingItem = (items: readonly HTMLElement[]): HTMLElement | undefined =>
  items.find(item => item.getAttribute('aria-checked') === 'true') ?? items.find(item => !item.dataset.back) ?? items[0]

/** Focuses a menu item and scrolls the menu to show it whole. */
export function show(item: HTMLElement | undefined) {
  if (!item) return
  item.focus({preventScroll: true})
  item.scrollIntoView({block: 'nearest'})
}
