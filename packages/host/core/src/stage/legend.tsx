import type {CSSProperties} from 'react'
import {resolveThemeTokens} from '@githubnext/projections-renderer-sdk/protocol'
import type {LegendShape} from '@githubnext/projections-renderer-sdk/protocol'
import type {ProjectionController} from '../projection.js'

/** A change fill token (`color-added-muted`, `color-removed-highlight`) and the same-hue edge token it takes. */
const changeFill = /^(color-(?:added|removed|modified|moved))-(?:muted|highlight)$/

/** The line swatches' border styles: a solid, dashed or dotted 2px rule. */
const lineStyles: Partial<Record<LegendShape, 'solid' | 'dashed' | 'dotted'>> = {line: 'solid', dashed: 'dashed', dotted: 'dotted'}

/**
 * A renderer's legend, drawn once for every pane: a band of the header
 * surface under the stage, edge to edge, ruled off above by a divider
 * hairline. Swatches resolve theme tokens from the host theme, so they match
 * the renderer's colors; a change fill swatch (`color-<change>-muted` or
 * `-highlight`) takes its same-hue `-border` edge, as renderers draw the fill.
 * A host colours the band with `--pj-legend-surface` and its hairline with
 * `--pj-legend-border-color`, and edges its label chips with
 * `--pj-legend-chip-border` (inline styles take no stylesheet's override).
 */
export function ProjectionLegend({
  projection,
  className,
  style,
}: {
  projection: ProjectionController
  className?: string
  style?: CSSProperties
}) {
  const legend = projection.legend
  if (!legend?.items.length) return null
  const tokens = resolveThemeTokens(projection.theme)
  const muted = tokens['color-fg-muted']
  return (
    <div
      className={`ph-legend ${className ?? ''}`}
      role="group"
      aria-label={legend.title ?? 'Legend'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px 14px',
        padding: '6px 10px',
        borderTop: `1px solid var(--pj-legend-border-color, ${tokens['color-divider']})`,
        background: `var(--pj-legend-surface, ${tokens['color-surface-header']})`,
        color: muted,
        fontFamily: tokens['font-family'],
        fontSize: tokens['font-size-sm'],
        lineHeight: 1.4,
        ...style,
      }}
    >
      {legend.title && (
        <span className="ph-legend-title" style={{fontWeight: 600, color: tokens['color-fg']}}>
          {legend.title}
        </span>
      )}
      <ul style={{display: 'contents', listStyle: 'none', margin: 0, padding: 0}}>
        {legend.items.map((item, index) => {
          const color = item.token ? tokens[item.token] : item.color
          // An item without a swatch is a plain label, drawn as a chip.
          if (!color)
            return (
              <li
                key={index}
                className="ph-legend-item"
                data-shape="label"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 6px',
                  border: `1px solid var(--pj-legend-chip-border, color-mix(in oklab, ${tokens['color-fg']} 20%, transparent))`,
                  borderRadius: tokens['radius-sm'],
                }}
              >
                {item.label}
              </li>
            )
          const shape = item.shape ?? 'square'
          const edge = item.token && changeFill.exec(item.token)
          const lineStyle = lineStyles[shape]
          const swatch: CSSProperties = lineStyle
            ? {width: 16, height: 0, borderTop: `2px ${lineStyle} ${color}`}
            : {
                boxSizing: 'border-box',
                width: 10,
                height: 10,
                borderRadius: shape === 'circle' ? '50%' : 2,
                background: color,
                ...(edge ? {border: `1px solid ${tokens[`${edge[1]}-border`]}`} : {}),
              }
          return (
            <li key={index} className="ph-legend-item" data-shape={shape} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
              <span aria-hidden="true" className="ph-legend-swatch" style={{flex: 'none', ...swatch}} />
              {item.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
