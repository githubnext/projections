// The toolbar's priority-collapse layout: the order its regions collapse in, measured against the toolbar's width.

import {useMemo, useRef} from 'react'
import type {RefObject} from 'react'
import {useFitPlan} from '@githubnext/projections-host'
import {focusControl} from '../elements.js'
import {actionCollapseOrder, locateStep, narrowToolbarWidth, rowForm, toolbarHysteresis, toolbarSteps} from './steps.js'
import type {ToolbarAction, ToolbarContent, ToolbarLayout} from './steps.js'
import {requiredWidth} from './measure.js'

/** Where focus goes when its control changes form or moves into an overflow. */
const focusFallbacks: Record<string, readonly string[]> = {
  'compare-from': ['revisions'],
  to: ['revisions'],
  swap: ['revisions'],
  revisions: ['compare-from'],
  'previous-step': ['playback-options'],
  'next-step': ['playback-options'],
  'playback-options': ['previous-step'],
  varied: ['more'],
  zoom: ['more'],
  filter: ['more'],
  info: ['more'],
  fullscreen: ['more'],
  more: ['filter'],
}

/** A second row with the steps inline, which also needs its slider across `playbackRowShare` of the row. */
const inlineSteps = (layout: ToolbarLayout) => layout.rows === 2 && !layout.playbackOverflow

/**
 * Chooses a `ToolbarLayout` for the toolbar `ref` points to with the host's `useFitPlan`: it measures the toolbar (not
 * the viewport, since toolbars are embedded at any width) and the width each step needs with the slider at its minimum
 * (and, for a second row with the steps inline, with the slider across `playbackRowShare` of the row). It collapses as
 * soon as a step doesn't fit and expands only with `toolbarHysteresis` to spare, so it doesn't flicker at a boundary.
 * New content, the slider's narrower minimum and the start region's own changes (a tab's notices) move every step's
 * need alike; playback coming or going keeps row 1's form and what it was measured to need. Mark controls with
 * `data-focus-id` so focus follows a control that changes form.
 */
export function useToolbarLayout(toolbar: RefObject<HTMLElement | null>, content: ToolbarContent): ToolbarLayout & {step: number} {
  const {pickers = false, modes = false, playback = false, centre = false} = content
  const actions = (content.actions === true ? actionCollapseOrder : content.actions || []).join(' ')
  const steps = useMemo(
    () => toolbarSteps({pickers, modes, playback, centre, actions: actions ? (actions.split(' ') as ToolbarAction[]) : []}),
    [pickers, modes, playback, centre, actions],
  )
  const key = content.key ?? ''
  // What a second row with the steps inline needs, measured on whichever such step is shown, for every one of them; a
  // new collapse order or content measures it again.
  const at = `${pickers}|${modes}|${playback}|${centre}|${actions}|${key}`
  const row = useRef<{at: string; need?: number}>({at})
  const {plan, index} = useFitPlan(toolbar, steps, {
    key: width => `${key}|${width < narrowToolbarWidth}`,
    shiftNeeds: true,
    carry: rowForm,
    locate: locateStep,
    measure: (element, layout) => {
      const {need, rowNeed} = requiredWidth(element, inlineSteps(layout))
      if (rowNeed !== undefined) row.current = {at, need: rowNeed}
      return need
    },
    need: (layout, own) => {
      if (!inlineSteps(layout)) return own
      const shared = row.current.at === at ? row.current.need : undefined
      return own === undefined || shared === undefined ? undefined : Math.max(own, shared)
    },
    hysteresis: toolbarHysteresis,
    // VSCode Elements render their shadow content a microtask after they mount: measure again once they have.
    pending: element => {
      const unrendered = [...element.querySelectorAll('*')].filter(
        (node): node is Element & {updateComplete: Promise<unknown>} =>
          'hasUpdated' in node && !(node as {hasUpdated?: boolean}).hasUpdated,
      )
      return unrendered.length ? Promise.all(unrendered.map(node => node.updateComplete)) : undefined
    },
    // Start content that changes on its own (a tab's notices come and go through their own store) changes what every
    // step needs without changing the toolbar's width.
    regions: ':scope > .phv-toolbar-start',
    focusFallbacks,
    focusControl: element => {
      focusControl(element)
    },
  })
  return {...plan, step: index}
}
