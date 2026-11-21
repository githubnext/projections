// Hover, selection and focus rings on each unit's own edge.
import {describe} from './paint.js'
import {settle} from './interaction.js'
import {edgeOf} from './rings/edges.js'
import {htmlRingFailures} from './rings/html.js'
import {svgRingFailures, unmarkedEdgeFailure} from './rings/svg.js'
import {isSvg, markedEdges, otherEdges, paintSignature, ringUnitOf, ringUnits} from './rings/units.js'
import type {Neutral, RingState} from './rings/units.js'

/*
 * Item rings. The SDK draws hover, focus and selection as styling on each
 * unit's own element: an outline inside an HTML unit's border box, or the
 * stroke of an SVG unit's marked edge shape (`data-projections-edge`). These
 * measurements hold renderers to that contract: the unit (or its marked edge)
 * must be the element that draws the item's visible edge, so the ring is that
 * edge. When it isn't, the failure names the element to mark.
 */
let neutral: Neutral | null = null

/** Resolves once nothing in the document animates (or after `timeoutMs`), then after a painted frame. */
async function still(timeoutMs = 1500): Promise<void> {
  const running = document
    .getAnimations()
    .filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity)
  if (running.length) {
    await Promise.race([
      Promise.allSettled(running.map(animation => animation.finished)),
      new Promise(resolve => {
        setTimeout(resolve, timeoutMs)
      }),
    ])
  }
  await settle()
}

/** Records `id`'s units at rest, before a ring state is applied. */
export async function ringNeutral(id: string): Promise<void> {
  await still()
  const units = ringUnits(id)
  neutral = {
    units: new Map(units.map(unit => [unit, {edge: edgeOf(unit), ring: paintSignature(unit)}])),
    edges: new Map(units.flatMap(markedEdges).map(edge => [edge as Element, paintSignature(edge)])),
    others: otherEdges(units),
  }
}

export async function ringFailures(target: {id: string; state: RingState}, only?: Element): Promise<string[]> {
  await still()
  return measuredRingFailures(target, only)
}

/**
 * Checks `id`'s units in `state`: each shows the SDK's ring as styling on
 * itself (or on its marked SVG edge), owns its visible edge, and nothing
 * else in it draws a ring of its own for the state.
 */
function measuredRingFailures({id, state}: {id: string; state: RingState}, only?: Element): string[] {
  const failures: string[] = []
  const units = only ? [ringUnitOf(only)] : ringUnits(id)
  for (const unit of units) {
    const unitId = unit.getAttribute('data-entity-id') ?? ''
    const name = unitId === id ? `"${id}"` : `"${unitId}" (around "${id}")`
    const box = unit.getBoundingClientRect()
    if (box.width <= 0 && box.height <= 0) continue
    if (isSvg(unit)) {
      const edges = markedEdges(unit)
      if (!edges.length) {
        failures.push(unmarkedEdgeFailure(unit, name))
        continue
      }
      failures.push(...svgRingFailures(unit, edges, name, state, neutral))
    } else failures.push(...htmlRingFailures(unit, box, name, state, neutral?.units.get(unit)))
    failures.push(...ownRingFailures(unit, name, state))
  }
  return failures
}

/** The renderer's own ring for the state: an outline, ring-shaped shadow, border or stroke that only the state adds. */
function ownRingFailures(unit: Element, name: string, state: RingState): string[] {
  if (!neutral) return []
  for (const [element, signature] of otherEdges([unit])) {
    const before = neutral.others.get(element)
    if (before === undefined || before === signature) continue
    return [
      `${describe(element)} in ${name} changes its own edge for ${state} (outline, ring-shaped shadow, border or stroke): the SDK's ring already shows it; draw none of your own`,
    ]
  }
  return []
}

/** Focuses `id`'s focus target, as a keyboard would, then checks its unit's focus ring. */
export async function ringFocusFailures(id: string): Promise<string[]> {
  const element = [...document.querySelectorAll('[data-entity-id]')].find(candidate => candidate.getAttribute('data-entity-id') === id)
  if (!element) return []
  const focusable = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href], input, select, textarea, summary'
  const target = (element.matches(focusable) ? element : element.querySelector(focusable)) as (HTMLElement | SVGElement) | null
  if (!target) return []
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  await ringNeutral(id)
  target.focus({preventScroll: true, focusVisible: true} as FocusOptions)
  try {
    if (!target.matches(':focus-visible')) return []
    // Focus rings the unit around the focused element only.
    return await ringFailures({id, state: 'focus'}, element)
  } finally {
    target.blur()
    await settle()
  }
}
