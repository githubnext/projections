import {useLayoutEffect, useRef, useState, type RefObject} from 'react'
import type {textPill} from '@githubnext/projections-renderer-kit'

/**
 * The advance of each text in `group` that matches `selector`, by its `data-label` (or its text), as the browser draws
 * it: a pill is sized
 * to the text it holds, so its sides are as far from the glyphs as its top and bottom (see the kit's `pillMetrics`).
 * Measured again when `key` changes (the texts drawn) and when a text resizes (its font loads); until it is measured,
 * `estimate` stands in.
 */
export function useTextAdvances(
  group: RefObject<SVGGElement | null>,
  selector: string,
  key: string,
  estimate: (text: string) => number,
): (text: string) => number {
  const [advances, setAdvances] = useState<ReadonlyMap<string, number>>(new Map())
  const latest = useRef(advances)
  latest.current = advances
  useLayoutEffect(() => {
    const element = group.current
    if (!element) return undefined
    const texts = [...element.querySelectorAll<SVGTextElement>(selector)]
    const measure = () => {
      const next = new Map(latest.current)
      let changed = false
      for (const text of texts) {
        const content = text.dataset.label ?? text.textContent
        const advance = text.getComputedTextLength()
        if (!advance || next.get(content) === advance) continue
        next.set(content, advance)
        changed = true
      }
      if (changed) setAdvances(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    for (const text of texts) observer.observe(text)
    return () => observer.disconnect()
  }, [group, selector, key])
  return text => advances.get(text) ?? estimate(text)
}

/**
 * The lifetime's pill, inset in the card's top right around its label (see `textPill`): its surface, over any change
 * fill under it, then the registration's hover, focus and selection tints in its own shape (`tint`, the part's tint
 * class, when the registration is a part of the card).
 */
export function LifetimePill({box, tint, selected}: {box: ReturnType<typeof textPill>; tint?: string | undefined; selected: boolean}) {
  return (
    <>
      <rect className="di-lifetime-pill di-lifetime-pill-surface" {...box} />
      {tint && <rect className={`di-tint ${tint} di-lifetime-pill`} {...box} />}
      {selected && <rect className="di-zone-highlight di-lifetime-pill" {...box} />}
    </>
  )
}
