// Where things are in a renderer's document, as both directions' messages carry them: anchors and scroll positions.
import type {AnchorRect, ScrollPosition} from './messages.js'
import {coordinate, keys, record} from './validation.js'

const scrollKeyPattern = /^[A-Za-z0-9_.:>\- ]{1,256}$/

export function anchorRect(value: unknown): AnchorRect | undefined {
  if (!record(value) || !keys(value, ['x', 'y', 'width', 'height'])) return undefined
  const {x, y, width, height} = value
  if (!coordinate(x) || !coordinate(y) || !coordinate(width) || !coordinate(height) || width < 0 || height < 0) return undefined
  return {x, y, width, height}
}

export function scrollPosition(message: Record<string, unknown>, envelope: readonly string[]): ScrollPosition | undefined {
  if (!keys(message, [...envelope, 'x', 'y', 'key'])) return undefined
  const {x, y, key} = message
  if (!coordinate(x) || !coordinate(y) || x < 0 || y < 0) return undefined
  if (key !== undefined && (typeof key !== 'string' || !scrollKeyPattern.test(key))) return undefined
  return {x, y, ...(key === undefined ? {} : {key})}
}
