import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {LegendItem, RendererLegend} from '@githubnext/projections-renderer-sdk/protocol'

const clip = (text: string) => (text.length <= rendererLimits.legendLabel ? text : `${text.slice(0, rendererLimits.legendLabel - 1)}…`)

/**
 * Fits a legend to the protocol's bounds: labels are clipped, and past
 * `rendererLimits.legendItems` the remainder folds into one "N more" item.
 */
export function boundedLegend(legend: RendererLegend): RendererLegend {
  const limit = rendererLimits.legendItems
  const items: LegendItem[] = legend.items.map(item => ({...item, label: clip(item.label)}))
  const fitted =
    items.length <= limit
      ? items
      : [
          ...items.slice(0, limit - 1),
          {label: `${(items.length - limit + 1).toLocaleString('en-US')} more`, token: 'color-border' as const},
        ]
  return {...(legend.title ? {title: clip(legend.title)} : {}), items: fitted}
}

export type {LegendItem, LegendShape, RendererLegend} from '@githubnext/projections-renderer-sdk/protocol'
