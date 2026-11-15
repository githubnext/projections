import {Component, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {ErrorInfo, HTMLAttributes, ReactNode} from 'react'
import type {ChangeStatus} from '@githubnext/projections-schemas'
import {proseSpans} from '@githubnext/projections-schemas'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import {identifier, variedBeyond, variedBeyondLabel} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {arrowHead, arrowHeadLength, arrowHeadStyle} from '../arrowhead.js'
import {LegendContext} from './legend-context.js'
import {classifyChange, statusLabels, statusParts} from '../emphasis.js'
import type {StatusPart} from '../emphasis.js'
import {Icon, SvgIcon} from './icons.js'
import {svgIcon, svgIconGap, svgPartGap, svgWordAdvance} from '../svg-status.js'
import type {StatusChange} from '../svg-status.js'

/**
 * Change badges, faded by emphasis. At zero emphasis they render nothing, so
 * endpoints carry no change decoration and release the badge's footprint.
 */
export function Badge({
  status,
  renamed,
  varied,
  emphasis = 1,
}: {
  status: ChangeStatus
  renamed?: boolean | undefined
  varied?: EntityChange<unknown>['varied'] | undefined
  emphasis?: number
}) {
  if (emphasis <= 0) return null
  return (
    <>
      {renamed && (
        <span className="badge renamed" style={{opacity: emphasis}} aria-hidden={emphasis < 0.05}>
          {statusLabels.renamed}
        </span>
      )}
      {(!renamed || status !== 'unchanged') && (
        <span className={`badge ${status}`} style={{opacity: emphasis}} aria-hidden={emphasis < 0.05}>
          {statusLabels[status]}
        </span>
      )}
      {variedBeyond({status, varied}) && <VariedMarker emphasis={emphasis} />}
    </>
  )
}

/**
 * The volatile marker: a `modified` change with a volatile value beyond its
 * tolerance (the SDK's `variedBeyond`) shows the `varied` icon beside its
 * status. It is neutral, in the text color rather than a change color,
 * and named for assistive technology ("Volatile field changed beyond
 * tolerance"). It fades with the status it accompanies. Draws nothing for any
 * other change, so an item that varied only within tolerance stays unchanged.
 */
export function VariedMarker({emphasis = 1, change}: {emphasis?: number; change?: StatusChange}) {
  if (emphasis <= 0.01 || (change && !variedBeyond(change))) return null
  return (
    <span
      className="pk-varied"
      data-varied="beyond"
      role="img"
      aria-label={variedBeyondLabel}
      title={variedBeyondLabel}
      style={{opacity: Math.min(1, emphasis)}}
      aria-hidden={emphasis < 0.05 || undefined}
    >
      <Icon name="varied" />
    </span>
  )
}

/**
 * A change's status as an icon and a word per part (Added, Renamed and
 * Modified, …), tinted with the change color, so status never rests on color
 * alone. Fades with `emphasis` and is empty at 0. `boxed` gives each word its
 * own box (`.pk-status-word`), which a footer strip can end in an ellipsis.
 */
function StatusText({change, emphasis, boxed = false}: {change: StatusChange; emphasis: number; boxed?: boolean}) {
  const parts = emphasis > 0.01 ? statusParts(change) : []
  if (!parts.length) return null
  return (
    <span className="pk-status-text" style={{opacity: Math.min(1, emphasis)}} aria-hidden={emphasis < 0.05}>
      {parts.map(part => (
        <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
          <Icon name={part.icon} />
          {boxed ? <span className="pk-status-word">{part.label}</span> : part.label}
        </span>
      ))}
      {variedBeyond(change) && <VariedMarker />}
    </span>
  )
}

/**
 * A change-status strip at the bottom of an item (a card, chip, tile or row).
 * Its height is always reserved, for unchanged items too and at every
 * progress, so status appearing or fading never moves anything. It shows the
 * status (see `StatusText`) while the change is emphasized: empty at both
 * endpoints and with highlighting off.
 */
export function ChangeFooter({change, emphasis, className}: {change: StatusChange; emphasis: number; className?: string}) {
  return (
    <div className={`pk-change-footer${className ? ` ${className}` : ''}`} data-change-footer="">
      <StatusText change={change} emphasis={emphasis} boxed />
    </div>
  )
}

/**
 * A change-status cell of fixed width, for table-like rows that keep their
 * status in a column: reserved on every row, filled while the change is
 * emphasized. `width` defaults to room for one part (`~ Modified`).
 */
export function ChangeStatus({change, emphasis, className}: {change: StatusChange; emphasis: number; className?: string}) {
  return (
    <span className={`pk-change-status${className ? ` ${className}` : ''}`} data-change-footer="">
      <StatusText change={change} emphasis={emphasis} />
    </span>
  )
}

/**
 * A pill's or chip's status as a tab hanging off its bottom edge: the icon and
 * word per part, filled and edged in the status hue, joined flush to the pill
 * and rounded on its free corners. Render it inside the pill (positioned:
 * `position: relative` or otherwise), which keeps its single-line box; the
 * pill's container reserves `--pk-tab-height` below every pill, so nothing
 * moves when status appears, but an unchanged pill draws nothing there. It
 * fades with `emphasis` and is absent at 0. `measure` draws it at full
 * strength, for measuring the room a pill needs (`.pk-status-tab` width plus
 * twice `--projections-radius`). The pill's accessible name carries the
 * status, so the tab is hidden from assistive technology.
 */
export function StatusTab({change, emphasis, measure = false}: {change: StatusChange; emphasis: number; measure?: boolean}) {
  const shown = measure ? 1 : emphasis
  const parts = shown > 0.01 ? statusParts(change) : []
  return (
    <span className="pk-status-tab-room" aria-hidden="true">
      {parts.length > 0 && (
        <span className="pk-status-tab pk-region" data-change={classifyChange(change)} style={{opacity: Math.min(1, shown)}}>
          {parts.map(part => (
            <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
              <Icon name={part.icon} />
              {part.label}
            </span>
          ))}
          {variedBeyond(change) && <VariedMarker />}
        </span>
      )}
    </span>
  )
}

let statusFont = ''
let statusCanvas: CanvasRenderingContext2D | null | undefined

const measuredWidths = new Map<string, number>()

/** The width of `text` drawn in the CSS `font`, measured on a canvas; undefined where there is none (outside a browser). */
function measuredWidth(font: string, text: string): number | undefined {
  if (!font) return undefined
  const key = `${font}\u0000${text}`
  const known = measuredWidths.get(key)
  if (known !== undefined) return known
  if (statusCanvas === undefined) statusCanvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!statusCanvas) return undefined
  statusCanvas.font = font
  const width = statusCanvas.measureText(text).width
  if (measuredWidths.size > 2000) measuredWidths.clear()
  measuredWidths.set(key, width)
  return width
}

/**
 * The words of a status line no wider than `room`: whole when they fit, else the last cut short with an ellipsis (then
 * the one before it), and a part that can't keep a character left out. `line` is a line's width with these words.
 */
function fitWords(words: readonly string[], room: number | undefined, line: (words: readonly string[]) => number): string[] {
  if (room === undefined || line(words) <= room) return [...words]
  const fitted = [...words]
  while (fitted.length > 1 || (fitted.length === 1 && fitted[0] !== '')) {
    const index = fitted.length - 1
    const word = words[index]!
    for (let keep = word.length - 1; keep >= 1; keep--) {
      fitted[index] = `${word.slice(0, keep).trimEnd()}…`
      if (line(fitted) <= room) return fitted
    }
    if (fitted.length === 1) fitted[0] = ''
    else fitted.pop()
  }
  return fitted
}

/**
 * One row of an SVG card's footer band, such as a change line (`Lifetime Scoped → Singleton`) above the status:
 * centred on `x` (by default 0, the middle of a card drawn about its centre) at the baseline `y`, as the status line
 * is (`SvgChangeStatus` with `anchor="middle"`), so every row of the band shares one axis. Its `children` are the
 * row's `tspan`s (spacing between them with `dx` is centred with them). Lay its text out within
 * `cardFooterRoom(width)`, wrapping longer text onto more rows, so it never reaches the card's sides.
 */
export function SvgFooterRow({
  x = 0,
  y,
  className,
  children,
}: {
  x?: number
  y: number
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <text className={className} x={x} y={y} textAnchor="middle" data-card-footer-row="" aria-hidden="true">
      {children}
    </text>
  )
}

/**
 * `StatusText` for SVG cards: one line at `x`, `y` (the text baseline) with
 * an icon and a word per part, for the card's own reserved footer band:
 * starting at `x`, ending there, or centred on it (`anchor`), never wider
 * than `room` (its last words end in an ellipsis instead, whole in its
 * tooltip). Words are measured in the font they are drawn in, so a centred
 * line is centred exactly from its first frame. Empty at zero emphasis.
 */
export function SvgChangeStatus({
  change,
  emphasis,
  x,
  y,
  anchor = 'start',
  room,
  parts: worded,
}: {
  change: StatusChange
  emphasis: number
  x: number
  y: number
  anchor?: 'start' | 'end' | 'middle'
  /** The most the line may take, icons included; its words are cut short to fit. Unlimited by default. */
  room?: number | undefined
  /** The domain's own wording of this change (see `StatusPart`); the generic wording otherwise. */
  parts?: readonly StatusPart[] | undefined
}) {
  const parts = emphasis > 0.01 ? (worded ?? statusParts(change)) : []
  const word = useRef<SVGTextElement | null>(null)
  // The font the words are drawn in, read once painted (and kept for the next status); until then words are
  // estimated at the label metrics' average advance.
  const [font, setFont] = useState(statusFont)
  const key = parts.map(part => part.label).join('\u0000')
  useLayoutEffect(() => {
    const element = word.current
    if (!element) return
    const style = getComputedStyle(element)
    const drawn = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    statusFont = drawn
    if (drawn !== font) setFont(drawn)
  }, [font, key])
  if (!parts.length) return null
  const width = (text: string) => measuredWidth(font, text) ?? text.length * svgWordAdvance
  const marker = variedBeyond(change)
  const markerWidth = marker ? svgIconGap * 2 + svgIcon : 0
  const line = (words: readonly string[]) =>
    words.reduce((sum, text) => sum + svgIcon + svgIconGap + width(text), 0) + svgPartGap * (words.length - 1) + markerWidth
  const words = fitWords(
    parts.map(part => part.label),
    room,
    line,
  )
  const spans = words.map(text => svgIcon + svgIconGap + width(text))
  const total = line(words)
  const start = anchor === 'end' ? x - total : anchor === 'middle' ? x - total / 2 : x
  let cursor = start
  const cut = words.some((text, index) => text !== parts[index]!.label)
  return (
    <g className="pk-svg-status" opacity={Math.min(1, emphasis)} aria-hidden={emphasis < 0.05}>
      {cut && <title>{parts.map(part => part.label).join(', ')}</title>}
      {words.map((text, index) => {
        const part = parts[index]!
        const left = cursor
        cursor += spans[index]! + svgPartGap
        return (
          <g key={index} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
            <SvgIcon name={part.icon} x={left} y={y - svgIcon + 2} size={svgIcon} />
            <text ref={index === 0 ? word : undefined} x={left + svgIcon + svgIconGap} y={y}>
              {text}
            </text>
          </g>
        )
      })}
      {marker && (
        <g className="pk-varied" data-varied="beyond" role="img" aria-label={variedBeyondLabel}>
          <title>{variedBeyondLabel}</title>
          <SvgIcon name="varied" x={start + total - svgIcon} y={y - svgIcon + 2} size={svgIcon} />
        </g>
      )}
    </g>
  )
}

/**
 * Text that is a code identifier or symbol (see the SDK's `identifier`):
 * drawn in the theme's monospace font, about a pixel smaller than its sans
 * neighbours so the two line up optically. Pass `truncate` for a name that
 * shrinks to an ellipsis on one line; its full text becomes the title.
 */
export function Identifier({
  children,
  truncate = false,
  className,
  title,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {truncate?: boolean}) {
  const text = typeof children === 'string' ? children : undefined
  return (
    <span
      {...rest}
      {...identifier}
      className={`pk-identifier${truncate ? ' pk-truncate' : ''}${className ? ` ${className}` : ''}`}
      title={title ?? (truncate ? text : undefined)}
    >
      {children}
    </span>
  )
}

/**
 * Human-readable protocol text (a reason, summary, notice, diagnostic or
 * detail) whose backtick-delimited spans are inline code, as the contracts
 * define: each span is drawn as a code identifier (monospace, marked
 * `data-projections-identifier`), the rest in the text font. Text is never
 * inserted as HTML. For a title, label or assistive text, use `plainProse`.
 */
export function Prose({children}: {children: string}) {
  return (
    <>
      {proseSpans(children).map((span, index) =>
        span.code ? (
          <code key={index} className="pk-code" {...identifier}>
            {span.text}
          </code>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * One line holding a name and its change badges: the name takes the room
 * left over and truncates with an ellipsis, while badges keep their full
 * width on the same line, never wrapping below or clipping at the edge.
 */
export function NameLine({children, badges, className}: {children: ReactNode; badges?: ReactNode; className?: string}) {
  return (
    <span className={`pk-name-line${className ? ` ${className}` : ''}`}>
      <span className="pk-name">{children}</span>
      {badges && <span className="pk-badges">{badges}</span>}
    </span>
  )
}

/**
 * A domain renderer's empty state, announced as a status: `title` as its heading (`No visible entities` by default)
 * and `children` explaining why, for example that a search matched nothing.
 */
export function EmptyDomain({title = 'No visible entities', children}: {title?: string; children: ReactNode}) {
  return (
    <div className="empty-state" role="status">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

/**
 * A status line saying a renderer draws only `shown` of `total` items (`noun`, plural, such as `entities`), pointing
 * to search and the host's table for the rest. Renders nothing when everything is shown.
 */
export function Notice({shown, total, noun}: {shown: number; total: number; noun: string}) {
  if (total <= shown) return null
  return (
    <p className="graph-notice" role="status">
      Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}. Search to narrow this view, or use the host's table for the
      complete model.
    </p>
  )
}

/**
 * Distinct entity kinds, as a legend the host draws once beside every pane.
 * Outside a kit renderer it draws them as compact chips.
 */
export function KindLegend({kinds, label = 'Entity kinds'}: {kinds: readonly string[]; label?: string}) {
  const report = useContext(LegendContext)
  const key = JSON.stringify([label, kinds])
  useEffect(() => {
    if (!report) return
    const [title, items] = JSON.parse(key) as [string, string[]]
    report({title, items: items.slice(0, rendererLimits.legendItems).map(kind => ({label: kind.slice(0, rendererLimits.legendLabel)}))})
    return () => report({items: []})
  }, [report, key])
  if (report || !kinds.length) return null
  return (
    <div className="kind-legend" role="list" aria-label={label}>
      {kinds.map(kind => (
        <span role="listitem" key={kind}>
          {kind}
        </span>
      ))}
    </div>
  )
}

/**
 * The kit's arrowhead (see `arrowHead`) as an SVG marker, for paths that end
 * at the head's base after a straight lead-in, such as `boxEdge`'s: the base
 * sits on the path's end and the tip `arrowHeadLength` beyond it.
 */
export function EdgeArrowMarker({id, color, highlight = false}: {id: string; color: string; highlight?: boolean}) {
  const head = arrowHead({x: arrowHeadLength, y: 0}, {x: 1, y: 0})
  return (
    <marker
      id={id}
      viewBox={`0 -${arrowHeadLength} ${arrowHeadLength * 2} ${arrowHeadLength * 2}`}
      markerUnits="userSpaceOnUse"
      markerWidth={arrowHeadLength * 2}
      markerHeight={arrowHeadLength * 2}
      refX="0"
      refY="0"
      orient="auto"
      overflow="visible"
    >
      <path d={head.path} data-projections-edge="fill" {...arrowHeadStyle(color)} {...(highlight ? {strokeWidth: 5} : {})} />
    </marker>
  )
}

interface BoundaryProps {
  children: ReactNode
  /** Clears a caught failure when it changes, for example when the host sends a new document. */
  resetKey: unknown
  onError?: ((message: string) => void) | undefined
}

/** Contains a presentation failure and reports it; the host's table and text views stay available. */
export class RendererBoundary extends Component<BoundaryProps, {error: string | null; resetKey: unknown}> {
  /** The caught failure's message, or `null` while the children render; the `resetKey` it was caught under. */
  override state = {error: null as string | null, resetKey: this.props.resetKey}
  /** Keeps a thrown error's message (or its string form, for a non-`Error`) to show in place of the children. */
  static getDerivedStateFromError(error: unknown) {
    return {error: error instanceof Error ? error.message : String(error)}
  }
  /** Clears a caught failure when `resetKey` changes, so the children render again. */
  static getDerivedStateFromProps(props: BoundaryProps, state: {error: string | null; resetKey: unknown}) {
    return props.resetKey === state.resetKey ? null : {error: null, resetKey: props.resetKey}
  }
  /** Reports the failure's message through `onError`, if given. */
  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error.message || String(error))
  }
  /** The children, or after a failure an alert with its message that points to the host's table and text views. */
  override render() {
    return this.state.error ? (
      <div className="error-state" role="alert">
        <h3>This presentation could not be rendered</h3>
        <p>{this.state.error}</p>
        <p>The host's table and text views remain available.</p>
      </div>
    ) : (
      this.props.children
    )
  }
}
