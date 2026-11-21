// The toolbar's priority-collapse layout: the order its regions collapse in, measured against the toolbar's width.

import {useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {RefObject} from 'react'
import {actionCollapseOrder, carryStep, choose, narrowToolbarWidth, toolbarSteps} from './steps.js'
import type {ToolbarAction, ToolbarContent, ToolbarLayout} from './steps.js'
import {requiredWidth} from './measure.js'
import {useFocusFollow} from './focus.js'

/**
 * Chooses a `ToolbarLayout` for the toolbar `ref` points to by measuring it: a ResizeObserver on the toolbar (not the
 * viewport, since toolbars are embedded at any width) and the width each step needs with the slider at its minimum (and,
 * for a second row with the steps inline, with the slider across `playbackRowShare` of the row).
 * It collapses as soon as a step doesn't fit and expands only with `toolbarHysteresis` to spare, so it doesn't flicker
 * at a boundary. Mark controls with `data-focus-id` so focus follows a control that changes form.
 */
export function useToolbarLayout(toolbar: RefObject<HTMLElement | null>, content: ToolbarContent): ToolbarLayout & {step: number} {
  const {pickers = false, modes = false, playback = false, centre = false} = content
  const actions = (content.actions === true ? actionCollapseOrder : content.actions || []).join(' ')
  const steps = useMemo(
    () => toolbarSteps({pickers, modes, playback, centre, actions: actions ? (actions.split(' ') as ToolbarAction[]) : []}),
    [pickers, modes, playback, centre, actions],
  )
  const ladder = `${pickers}|${modes}|${playback}|${centre}|${actions}`
  const key = content.key ?? ''
  const [state, setState] = useState({
    ladder,
    steps,
    key,
    narrow: false,
    stale: false,
    step: 0,
    width: 0,
    required: [] as (number | undefined)[],
    rowNeed: undefined as number | undefined,
  })
  let current = state
  if (state.ladder !== ladder) {
    // Another collapse order. Playback coming or going keeps row 1's settled form and what was measured, corrected once
    // that step is measured, so hysteresis still applies and row 1 doesn't move; anything else starts from the top.
    const carried = carryStep(state.steps, state.step, state.required, steps)
    current = carried
      ? {...state, ladder, steps, key, stale: true, ...carried, rowNeed: undefined}
      : {...state, ladder, steps, key, stale: false, step: 0, required: [], rowNeed: undefined}
    setState(current)
  } else if (state.key !== key) {
    // The same order with other content: keep the step, and correct what the others need once this one is measured.
    current = {...state, key, stale: true, rowNeed: undefined}
    setState(current)
  }
  const index = Math.min(current.step, steps.length - 1)

  useLayoutEffect(() => {
    const element = toolbar.current
    if (!element) return
    const width = Math.floor(element.getBoundingClientRect().width)
    if (!width) return
    const layout = steps[Math.min(state.step, steps.length - 1)]!
    const {need, rowNeed} = requiredWidth(element, layout.rows === 2 && !layout.playbackOverflow)
    // VSCode Elements render their shadow content a microtask after they mount: measure again once they have.
    const unrendered = [...element.querySelectorAll('*')].filter(
      (node): node is Element & {updateComplete: Promise<unknown>} => 'hasUpdated' in node && !(node as {hasUpdated?: boolean}).hasUpdated,
    )
    if (unrendered.length)
      void Promise.all(unrendered.map(node => node.updateComplete)).then(() =>
        setState(previous => (previous.ladder === ladder && previous.key === key ? {...previous, stale: true, width: 0} : previous)),
      )
    setState(previous => {
      if (previous.ladder !== ladder || previous.key !== key) return previous
      const narrow = width < narrowToolbarWidth
      let required = [...previous.required]
      const known = required[previous.step]
      // Content and the slider's minimum (across the narrow boundary) change every step's need alike.
      if ((previous.stale || narrow !== previous.narrow) && known !== undefined && known !== need)
        required = required.map(value => (value === undefined ? undefined : value + need - known))
      required[previous.step] = need
      const row = rowNeed ?? previous.rowNeed
      const next = choose(steps, required, row, previous.step, width)
      if (
        next === previous.step &&
        !previous.stale &&
        previous.width === width &&
        previous.narrow === narrow &&
        previous.required[previous.step] === need &&
        previous.rowNeed === row
      )
        return previous
      return {...previous, narrow, stale: false, step: next, width, required, rowNeed: row}
    })
  }, [toolbar, ladder, key, steps, state.step, state.width])

  useLayoutEffect(() => {
    const element = toolbar.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry?.borderBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width ?? 0)
      setState(previous => (previous.width === width ? previous : {...previous, width}))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [toolbar])

  // Start content that changes on its own (a tab's notices come and go through their own store) changes what every
  // step needs, without changing the toolbar's width: when the start region resizes, measure again, correcting the
  // others. It is found after every render, since it mounts and unmounts with its content.
  const start = useRef<{element: Element; observer: ResizeObserver} | null>(null)
  useLayoutEffect(() => {
    const element = toolbar.current?.querySelector(':scope > .phv-toolbar-start') ?? null
    if (start.current?.element === element) return
    start.current?.observer.disconnect()
    start.current = null
    if (!element) return
    let width = element.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width
      if (Math.abs(next - width) < 0.5) return
      width = next
      setState(previous => ({...previous, stale: true, width: 0}))
    })
    observer.observe(element)
    start.current = {element, observer}
  })
  useLayoutEffect(() => () => start.current?.observer.disconnect(), [])

  useFocusFollow(toolbar)

  return {...steps[index]!, step: index}
}
