// Entities as drawn: samples, texts, fonts, the content's top and legends.
import type {ContentTop, EntitySample, EntityText, IdentifierMeasurement} from '../types.js'
import {canvasContext, visuallyHidden, effectiveOpacity, visible, describe, paintOf} from './paint.js'

/** Every visible entity element, as painted. */
export function entitySamples(root: Element = document.body): EntitySample[] {
  const seen = new Map<string, number>()
  const samples: EntitySample[] = []
  for (const element of root.querySelectorAll('[data-entity-id]')) {
    if (!visible(element)) continue
    const id = element.getAttribute('data-entity-id') ?? ''
    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    const box = element.getBoundingClientRect()
    const round = (value: number) => Math.round(value * 2) / 2
    samples.push({
      key: count ? `${id}#${count}` : id,
      id,
      box: [round(box.left), round(box.top), round(box.width), round(box.height)],
      opacity: Math.round(effectiveOpacity(element) * 100) / 100,
      ...paintOf(element),
      parts: [...new Set([...element.querySelectorAll('[data-entity-id]')].map(part => part.getAttribute('data-entity-id')!))],
    })
  }
  return samples
}

/** IDs of visible entities: nested ones (parts) first, then units. */
export function visibleEntities(root: Element = document.body): string[] {
  const all = [...root.querySelectorAll('[data-entity-id]')].filter(visible)
  const nested = all.filter(element => element.parentElement?.closest('[data-entity-id]'))
  return [...new Set([...nested, ...all].map(element => element.getAttribute('data-entity-id')!))]
}

/**
 * Visible identifier elements (`data-projections-identifier`) and those whose
 * computed font isn't monospace. A font is monospace when narrow and wide
 * glyphs measure the same in it, so the check needs no list of font names.
 */
export function identifierFonts(root: Element = document.body): IdentifierMeasurement {
  const context = canvasContext()
  const proportional: string[] = []
  let count = 0
  for (const element of root.querySelectorAll('[data-projections-identifier]')) {
    if (!visible(element) || !element.textContent?.trim()) continue
    count++
    const style = getComputedStyle(element)
    if (!context) continue
    context.font = `${style.fontStyle} ${style.fontWeight} 40px ${style.fontFamily}`
    const narrow = context.measureText('iiiiiiiiii').width,
      wide = context.measureText('MMMMMMMMMM').width
    if (Math.abs(narrow - wide) > 1 && proportional.length < 10) {
      proportional.push(`${describe(element)} "${element.textContent.trim().slice(0, 40)}" is in ${style.fontFamily}`)
    }
  }
  return {count, proportional}
}

/**
 * Where the renderer's content starts: the top of its first visible entity
 * (`data-entity-id`), outermost SVG canvas, or region it marks as content
 * (`data-projections-content`, for content that isn't an entity, such as an
 * axis, a table head or a plan's summary). A zoomable canvas (`data-zoom`)
 * counts as a whole: it opens fitted (or at the text floor) and centres its drawing, so what it draws
 * may start below its top. Anything a renderer draws above that, such as a
 * title, schema or counts header, pushes it down.
 */
export function contentTop(root: Element = document.body): ContentTop {
  let best: ContentTop = {top: Infinity, element: 'nothing'}
  for (const element of root.querySelectorAll('[data-entity-id], svg, [data-projections-content], [data-zoom]')) {
    if (element instanceof SVGSVGElement && element.parentElement?.closest('svg')) continue
    if (!element.matches('[data-zoom]') && element.parentElement?.closest('[data-zoom]')) continue
    if (!visible(element) || visuallyHidden(element, getComputedStyle(element))) continue
    const box = element.getBoundingClientRect()
    if (box.height < 1 || box.width < 1) continue
    if (box.top < best.top) best = {top: Math.round(box.top * 10) / 10, element: describe(element)}
  }
  return best
}

/** Every entity element's text, `aria-label`s and `title`s (its own and its descendants'), whether painted or not. */
export function entityTexts(root: Element = document.body): EntityText[] {
  return [...root.querySelectorAll('[data-entity-id]')].map(element => {
    // Text nodes one by one, so adjacent words (a name and its badge) stay separate.
    const words: string[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) words.push(node.textContent.trim())
    const labels = [element, ...element.querySelectorAll('*')].flatMap(node => [
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
    ])
    return {id: element.getAttribute('data-entity-id') ?? '', text: [...labels.filter(Boolean), ...words].join(' ')}
  })
}

/**
 * Visible legends the renderer draws in its own frame: `data-projections-legend`, `.kind-legend`, or a region labelled
 * as a legend. An entity is content, never a legend, even when its name says legend (a file `legend.ts`).
 */
export function legends(): string[] {
  return [...document.querySelectorAll('[data-projections-legend], .kind-legend, [aria-label]')]
    .filter(
      element =>
        element.matches('[data-projections-legend], .kind-legend') ||
        (/legend/i.test(element.getAttribute('aria-label') ?? '') && !element.closest('[data-entity-id]')),
    )
    .filter(element => !element.parentElement?.closest('[data-projections-legend], .kind-legend'))
    .filter(visible)
    .map(describe)
}
