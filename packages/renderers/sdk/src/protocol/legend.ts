// A renderer's legend, as its `legend` message posts it.
import {themeTokenNames, type ThemeTokenName} from '../tokens.js'
import {rendererLimits} from './frame.js'
import {legendShapes, type LegendItem, type LegendShape, type RendererLegend} from './messages.js'
import {cssColor, keys, record} from './validation.js'

/** Validates one legend item: a label, and a swatch (`token` or `color`, never both) with an optional `shape`. */
function parseLegendItem(item: unknown): LegendItem | undefined {
  if (!record(item) || !keys(item, ['label', 'token', 'color', 'shape'])) return undefined
  if (typeof item.label !== 'string' || !item.label || item.label.length > rendererLimits.legendLabel) return undefined
  if (item.token !== undefined && item.color !== undefined) return undefined
  if (item.shape !== undefined && item.token === undefined && item.color === undefined) return undefined
  if (item.token !== undefined && !themeTokenNames.includes(item.token as ThemeTokenName)) return undefined
  if (item.color !== undefined && !(typeof item.color === 'string' && cssColor.test(item.color))) return undefined
  if (item.shape !== undefined && !legendShapes.includes(item.shape as LegendShape)) return undefined
  return {
    label: item.label,
    ...(item.token === undefined ? {} : {token: item.token as ThemeTokenName}),
    ...(item.color === undefined ? {} : {color: item.color as string}),
    ...(item.shape === undefined ? {} : {shape: item.shape as LegendShape}),
  }
}

/** Validates a `legend` message's title and items, `fields` being the message's envelope fields besides them. */
export function parseLegend(message: Record<string, unknown>, fields: readonly string[]): RendererLegend | undefined {
  if (!keys(message, [...fields, 'title', 'items']) || !Array.isArray(message.items) || message.items.length > rendererLimits.legendItems) {
    return undefined
  }
  const {title} = message
  if (title !== undefined && !(typeof title === 'string' && title.length > 0 && title.length <= rendererLimits.legendLabel)) {
    return undefined
  }
  const items: LegendItem[] = []
  for (const value of message.items as unknown[]) {
    const item = parseLegendItem(value)
    if (!item) return undefined
    items.push(item)
  }
  return {...(title === undefined ? {} : {title: title as string}), items}
}
