// How a new view of the same document moves from the old one: the frames between them, and where the activated card was.
import {useEffect, useState, type RefObject} from 'react'
import type {GraphFrame, GraphTransition} from '../../graph-transition.js'
import type {Point} from '../../edge-arrows.js'
import {morphFrames, shiftFrame, viewChangeMs} from '../../graph-canvas/view-change.js'
import type {Bounds} from './framing.js'
import type {GraphAnchor} from './props.js'

/** The scope key while the host hasn't said what it shows. */
export const provisional = 'provisional'

/** What was drawn last: the transition and the frame it was at, where it was framed and at what scale. */
export interface Drawn {
  transition: GraphTransition
  target: GraphFrame
  bounds: Bounds
  scale: number
}

/** A card's top left corner, layout units. */
export const corner = (node: {x: number; y: number; width: number; height: number}): Point => ({
  x: node.x - node.width / 2,
  y: node.y - node.height / 2,
})

/**
 * What `useViewChange` hands `useAnchoredScroll`: the card in the activated one's place, and where the activated one
 * was in the drawing as drawn, CSS px from its layout origin; it was on screen there, from the drawing's origin then.
 */
export interface ViewChange {
  to: string
  at: Point
}

/**
 * A new view of the same document laid out after the person activated a card (`anchor`, see `GraphAnchor`): keeps the
 * drawn scale (`hold`, for `useGraphZoom`), notes where the activated card was drawn (`change`, for
 * `useAnchoredScroll`), and returns the frames that move the cards there from the old view, which may reach outside
 * the new view's bounds while they move (`overflow`). Without an anchor, or for the first view, it returns `target`.
 * `last` is what the previous render drew.
 */
export function useViewChange(
  scrollerRef: RefObject<HTMLDivElement | null>,
  last: Drawn | undefined,
  anchor: GraphAnchor | undefined,
  transition: GraphTransition,
  target: GraphFrame,
  reducedMotion: boolean,
  scopeKey: string,
) {
  const [used, setUsed] = useState<GraphAnchor>()
  const [held, setHeld] = useState<{key: unknown; scale: number}>()
  const [change, setChange] = useState<ViewChange>()
  const [scope, setScope] = useState({key: scopeKey, rescoped: false})
  const [morph, setMorph] = useState<{from: GraphFrame; to: GraphTransition; mix: number}>()
  // The frame drawn last: its target, or a step of the move to it.
  const previous = last && (morph?.to === last.transition && morph.mix < 1 ? morphFrames(morph.from, last.target, morph.mix) : last.target)
  const relaid = last !== undefined && previous !== undefined && last.transition !== transition
  if (relaid && anchor && anchor !== used) {
    setUsed(anchor)
    setHeld({key: anchor, scale: last.scale})
    const was = previous.nodes.find(node => node.id === anchor.from)
    const now = target.nodes.find(node => node.id === anchor.to)
    if (was && now) {
      const from = corner(was),
        to = corner(now)
      setChange({to: anchor.to, at: {x: (from.x - last.bounds.minX) * last.scale, y: (from.y - last.bounds.minY) * last.scale}})
      // The old view, moved so the activated card is where its replacement is: that card stays put while the rest move.
      const start = shiftFrame(previous, {x: to.x - from.x, y: to.y - from.y})
      setMorph(reducedMotion ? undefined : {from: start, to: transition, mix: 0})
    }
  }
  // A new scope lays the document out again: the cards move from the old layout to the new one, those it adds or leaves
  // out fading in or out, rather than jumping. The layout arrives after the scope does (it's laid out in the
  // background), so the change waits for it.
  let scoped = scope.key === scopeKey ? scope : {key: scopeKey, rescoped: scope.key !== provisional}
  if (relaid && scoped.rescoped) {
    scoped = {...scoped, rescoped: false}
    if (!reducedMotion) setMorph({from: previous, to: transition, mix: 0})
  }
  if (scoped !== scope) setScope(scoped)
  const moving = morph?.to === transition && morph.mix < 1
  const frame = moving ? morphFrames(morph.from, target, morph.mix) : target
  const moved = morph?.from
  useEffect(() => {
    const view = scrollerRef.current?.ownerDocument.defaultView
    if (!moved || !view) return undefined
    let started: number | undefined
    let request = 0
    const tick = (time: number) => {
      started ??= time
      const mix = Math.max(1e-6, Math.min(1, (time - started) / viewChangeMs))
      setMorph(current => (current?.from === moved ? {...current, mix} : current))
      if (mix < 1) request = view.requestAnimationFrame(tick)
    }
    request = view.requestAnimationFrame(tick)
    return () => view.cancelAnimationFrame(request)
  }, [moved, scrollerRef])
  return {frame, hold: held, overflow: moving, change}
}
