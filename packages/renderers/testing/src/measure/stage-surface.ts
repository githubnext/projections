// The field a renderer paints behind its content: the stage its cards and panels stand on.
import type {StageSurfaceMeasurement, StageSurfaceSample} from '../types.js'
import {colorAlpha, describe, normalizeColors} from './paint.js'

/** How far inside the frame's edges the field is sampled, in CSS px: inside any content, which starts on the stage's inset. */
const inset = 2

/**
 * The color painted at a point: the topmost background or SVG fill there beneath any drawn entity, or `transparent`
 * when nothing paints it.
 */
function paintedAt(x: number, y: number): Omit<StageSurfaceSample, 'where'> {
  const at = `${Math.round(x)}, ${Math.round(y)}`
  for (const element of document.elementsFromPoint(x, y)) {
    if (element.closest('[data-projections-host-overlay]')) continue
    // What is drawn there is content, not the field behind it: a canvas opened zoomed reaches the frame's edges.
    if (element.closest('[data-entity-id], [data-graph-synthetic]')) continue
    const exempt = element.closest('[data-projections-off-system]')
    if (exempt) return {at, color: 'exempt', element: describe(exempt)}
    const style = getComputedStyle(element)
    const shape = element instanceof SVGGraphicsElement && !(element instanceof SVGSVGElement)
    const color = normalizeColors(shape ? style.fill : style.backgroundColor)
    const alpha = colorAlpha(color) * (shape ? Number(style.fillOpacity) : 1)
    if (alpha > 0.01 && !color.startsWith('url(')) return {at, color, element: describe(element)}
  }
  return {at, color: 'transparent', element: 'nothing (the host frame)'}
}

/**
 * The renderer's field, sampled just inside the frame's edges (its top corners, and its sides halfway down the frame or
 * the document, whichever is shorter), with the stage token this document resolves.
 */
export function stageSurface(): StageSurfaceMeasurement {
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.color = 'var(--projections-color-surface-canvas)'
  document.body.append(probe)
  const stage = normalizeColors(getComputedStyle(probe).color)
  probe.remove()
  const width = document.documentElement.clientWidth
  const height = Math.min(innerHeight, document.documentElement.scrollHeight)
  const left = inset,
    right = width - inset - 1
  const points: [string, number, number][] = [
    ['top left', left, inset],
    ['top right', right, inset],
    ['left side', left, height / 2],
    ['right side', right, height / 2],
  ]
  return {stage, samples: points.map(([where, x, y]) => ({...paintedAt(x, y), where}))}
}
