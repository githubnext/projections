import {useCallback, useEffect, useRef, useState} from 'react'
import type {RefObject} from 'react'
import type {RendererClient} from '@githubnext/projections-renderer-sdk/client'
import {useInteractions} from '@githubnext/projections-renderer-sdk/react'

/** What a renderer's own controls are; a click on one is that control's (a toggle, a menu, an expander, an item's button). */
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
 * Clicks that change the selection without an item's own handler: a click on the renderer's background clears it, and
 * a click on an item's element outside any control (a card's fields, below its select button) toggles that item, as
 * its button would. A click an item's handler already acted on, the second click of a double-click, a drag (panning,
 * selecting text), and a click on any other control change nothing here. `state.clicks` is the click count of the
 * click being dispatched (0 for the keyboard), for `onSelect`.
 */
function selectionClicks(
  root: HTMLElement,
  state: {handled: {current: boolean}; current: {current: string | null}; clicks: {current: number}},
  select: (id: string | null) => void,
): () => void {
  const document = root.ownerDocument
  let down: {x: number; y: number} | undefined
  const press = (event: PointerEvent) => {
    down = event.isPrimary ? {x: event.clientX, y: event.clientY} : undefined
  }
  const key = () => {
    state.clicks.current = 0
  }
  // Capture, before any item's handler runs: this click hasn't changed the selection.
  const start = (event: MouseEvent) => {
    state.handled.current = false
    state.clicks.current = event.detail
  }
  const click = (event: MouseEvent) => {
    const acted = state.handled.current
    state.handled.current = false
    const from = down
    down = undefined
    if (acted || event.defaultPrevented || event.button !== 0) return
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4) return
    if (document.getSelection()?.isCollapsed === false) return
    const target = event.target instanceof Element ? event.target : undefined
    if (!target || target.closest(controls)) return
    const selected = state.current.current
    if (!root.contains(target)) {
      // The frame's empty area around the renderer is background too.
      if ((target === document.documentElement || target === document.body) && selected !== null) select(null)
      return
    }
    const item = target.closest('[data-entity-id]')
    const id = item && root.contains(item) ? item.getAttribute('data-entity-id') : null
    if (!id) {
      if (selected !== null) select(null)
    } else if (id !== selected) select(id)
    else if (event.detail < 2) select(null)
  }
  document.addEventListener('pointerdown', press, true)
  document.addEventListener('keydown', key, true)
  document.addEventListener('click', start, true)
  document.addEventListener('click', click)
  return () => {
    document.removeEventListener('pointerdown', press, true)
    document.removeEventListener('keydown', key, true)
    document.removeEventListener('click', start, true)
    document.removeEventListener('click', click)
  }
}

/**
 * The selection a kit renderer shows. It is optimistic locally, and every host `select` message wins, even one
 * repeating a value. `setSelection` changes it as the renderer does (an annotation badge selects its item here too, and
 * never clears it); `onSelect` as the person activating an item does (see `RendererProps.onSelect`). Interactive
 * renderers also get the host's interactions and the clicks that select (see `selectionClicks`).
 */
export function useSelection(
  client: RendererClient | undefined,
  host: {selection: string | null; selectionVersion: number},
  root: RefObject<HTMLDivElement | null>,
  interactive: boolean,
  partOf?: (id: string) => string | undefined,
): {selected: string | null; setSelection: (id: string | null) => void; onSelect: (id: string | null) => void} {
  const {selection, selectionVersion} = host
  const [selected, setSelected] = useState<string | null>(selection)
  const [seenSelection, setSeenSelection] = useState(selectionVersion)
  if (seenSelection !== selectionVersion) {
    setSeenSelection(selectionVersion)
    setSelected(selection)
  }
  // The selection as of the latest change, read by handlers that run before the next render.
  const current = useRef(selected)
  current.current = selected
  // Whether the click being dispatched has already changed the selection, and its click count (see `selectionClicks`).
  const handled = useRef(false)
  const clicks = useRef(0)
  const setSelection = useCallback(
    (id: string | null) => {
      handled.current = true
      current.current = id
      setSelected(id)
      client?.select(id)
    },
    [client],
  )
  const onSelect = useCallback(
    (id: string | null) => {
      if (id === null || id !== current.current) {
        setSelection(id)
        return
      }
      // The second click of a double-click keeps the item its first click selected.
      if (clicks.current > 1) handled.current = true
      else setSelection(null)
    },
    [setSelection],
  )
  // Activating an annotation badge selects its item here too (and never clears it).
  useInteractions(interactive ? client : undefined, root, selected, {select: setSelection, ...(partOf ? {partOf} : {})})
  useEffect(
    () => (interactive && root.current ? selectionClicks(root.current, {handled, current, clicks}, setSelection) : undefined),
    [interactive, setSelection, root],
  )
  return {selected, setSelection, onSelect}
}
