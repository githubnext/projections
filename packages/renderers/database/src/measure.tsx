import {useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {ChangeStatus} from '@githubnext/projections-renderer-kit/react'
import {defaultChrome, type MeasureText, type TextChrome, type TextRole} from './text.js'

/**
 * Text drawn in the lines the layout counted (see text.ts): each line whole,
 * the only break opportunities between them, so the browser's lines are the
 * layout's and the text reads (and copies) as one string.
 */
export function Breakable({lines}: {lines: readonly string[]}): ReactNode {
  return lines.map((line, index) => (
    <span key={index} className="database-line">
      {index > 0 && <wbr />}
      {line}
    </span>
  ))
}

const roles: readonly TextRole[] = ['name', 'kind', 'column', 'type', 'key', 'value', 'status']

/**
 * Measures text the way the cards draw it: a hidden copy of a header and a row
 * (`probe`) gives each role's computed font, and a canvas measures strings in
 * it; the probe's own boxes give the widths that aren't text. Re-measures when
 * fonts load. Until then (and without a canvas), the layout estimates.
 */
export function useTextMeasure(): {probe: ReactNode; measure?: MeasureText; chrome: TextChrome} {
  const root = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{measure?: MeasureText; chrome: TextChrome}>({chrome: defaultChrome})
  useLayoutEffect(() => {
    const element = root.current
    const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (!element || !context) return
    const read = () => {
      const fonts = new Map<TextRole, string>()
      for (const role of roles) {
        const style = getComputedStyle(element.querySelector(`[data-measure="${role}"]`)!)
        fonts.set(role, `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
      }
      const width = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect().width
      const px = (selector: string, property: string) =>
        parseFloat(getComputedStyle(element.querySelector(selector)!).getPropertyValue(property)) || 0
      const status = getComputedStyle(element.querySelector('[data-measure="status"]')!)
      const chrome: TextChrome = {
        headerPad: px('header', 'padding-left'),
        headerGap: px('header', 'column-gap'),
        // A status part: an icon 1em square, 0.3em before its word (the kit's .pk-status-part); parts are a gap apart.
        statusIcon: 1.3 * parseFloat(status.fontSize),
        statusGap: parseFloat(status.columnGap) || 8,
        // A value pill (the kit's .pk-change-pill): label padding and a border each side; values a space-1 apart.
        pillPad:
          2 * (parseFloat(getComputedStyle(element).getPropertyValue('--projections-label-padding-x')) || 7) +
          2 * (parseFloat(getComputedStyle(element).getPropertyValue('--projections-border-width')) || 1),
        valueGap: parseFloat(getComputedStyle(element).getPropertyValue('--projections-space-1')) || 4,
        rowPadLeft: px('.database-measure-row.column', 'padding-left'),
        rowPadRight: px('.database-measure-row.column', 'padding-right'),
        rowGap: px('.database-measure-row.column', 'column-gap'),
        marker: width('.database-measure-row.column .database-key'),
        glyph: width('.database-measure-row.column .database-measure-glyph'),
      }
      const measure: MeasureText = (role, text) => {
        context.font = fonts.get(role)!
        return context.measureText(text).width
      }
      setState({measure, chrome})
    }
    read()
    document.fonts?.addEventListener('loadingdone', read)
    return () => document.fonts?.removeEventListener('loadingdone', read)
  }, [])
  const probe = (
    <div ref={root} className="database-measure" aria-hidden="true" inert>
      <div className="database-measure-card">
        <header className="database-measure-header">
          <span className="entity-link" data-measure="name" {...identifier}>
            M
          </span>
          <span className="database-kind" data-measure="kind">
            enum
          </span>
          <ChangeStatus change={{status: 'unchanged'}} emphasis={0} className="database-status" />
          <span className="database-measure-status" data-measure="status">
            Modified
          </span>
        </header>
        <div className="database-measure-row column">
          <span className="database-key">PK</span>
          <span className="database-rowtext">
            <span className="entity-link" data-measure="column" {...identifier}>
              M
            </span>
            <code data-measure="type" {...identifier}>
              M
            </code>
          </span>
          <span className="database-measure-glyph" />
        </div>
        <div className="database-measure-row key">
          <span className="database-rowtext">
            <span className="entity-link" data-measure="key" {...identifier}>
              M
            </span>
          </span>
          <span className="database-measure-glyph" />
        </div>
        <div className="database-measure-row value">
          <span className="database-rowtext">
            <code className="database-value-name" data-measure="value" {...identifier}>
              M
            </code>
          </span>
          <span className="database-measure-glyph" />
        </div>
      </div>
    </div>
  )
  return {probe, ...state}
}
