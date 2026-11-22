import type {RendererLegend, ThemeTokenName} from '@githubnext/projections-host'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/** The props of `VscodeLegend`: the renderer's legend and the tokens its swatches resolve against. */
export interface VscodeLegendProps {
  /** The renderer's legend (`ProjectionController.legend`); nothing is drawn without items. */
  legend: RendererLegend | undefined
  /** Resolved theme tokens (`ProjectionController.theme.tokens`): swatches draw the renderer's own colors. */
  tokens?: Readonly<Record<string, string>> | undefined
  className?: string | undefined
}

const swatchHue = /^color-(added|removed|modified|moved)(?:-muted|-emphasis|-border|-highlight)?$/

/**
 * The renderer's legend, drawn once outside the panes like VS Code's panel footer: a swatch in a change hue keeps that
 * hue's `-border` edge, so a tinted swatch never stands as a fill alone.
 */
export function VscodeLegend({legend, tokens, className}: VscodeLegendProps) {
  if (!legend?.items.length) return null
  return (
    <div className={`ph-legend phv-legend ${className ?? ''}`} role="group" aria-label={legend.title ?? 'Legend'}>
      {legend.title && <span className="ph-legend-title phv-legend-title">{legend.title}</span>}
      <ul className="phv-legend-items">
        {keyed(legend.items, item => item.label).map(([key, item]) => {
          const color = item.token ? tokens?.[item.token as ThemeTokenName] : item.color
          if (!color) {
            return (
              <li key={key} className="ph-legend-item phv-legend-item" data-shape="label">
                {item.label}
              </li>
            )
          }
          const shape = item.shape ?? 'square'
          const hue = item.token?.match(swatchHue)?.[1]
          const line = shape === 'line' || shape === 'dashed' || shape === 'dotted'
          return (
            <li key={key} className="ph-legend-item phv-legend-item" data-shape={shape}>
              <span
                aria-hidden="true"
                className="ph-legend-swatch phv-legend-swatch"
                data-change={hue}
                style={line ? {borderTopColor: color} : {backgroundColor: color}}
              />
              {item.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
