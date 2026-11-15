import type {CSSProperties, ReactNode} from 'react'
import type {Side} from '../modes.js'
import {paneGeometry} from './arrangement.js'

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
}
/** Labels that name a side in words rather than a revision: they stay in the text face. */
const genericLabels = new Set(['Before', 'After', 'A', 'B'])

/**
 * A revision label (`name · detail · when`, see the Inspector's `revisions.ts`): its name is an identifier (a branch,
 * tag, commit or `HEAD~1`), so it is set in the monospace face; the detail and time stay in the text face.
 */
function RevisionText({label}: {label: ReactNode}) {
  if (typeof label !== 'string' || genericLabels.has(label.trim())) return <>{label}</>
  const [name = '', ...rest] = label.split(' · ')
  return (
    <>
      <span style={{fontFamily: 'var(--projections-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'}}>{name}</span>
      {rest.length > 0 && ` · ${rest.join(' · ')}`}
    </>
  )
}

function RevisionHeading({side, label}: {side: Side; label: ReactNode}) {
  return (
    <>
      <span style={srOnly}>{side === 'before' ? 'Before revision: ' : 'After revision: '}</span>
      <RevisionText label={label} />
    </>
  )
}

const labelStyle: CSSProperties = {
  width: 'fit-content',
  maxWidth: 'calc(50% - 16px)',
  margin: 0,
  padding: '1px 7px',
  fontSize: '0.8em',
  fontWeight: 600,
  lineHeight: 1.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: '1px solid var(--projections-color-border, #d1d9e0)',
  borderRadius: 'var(--projections-radius-sm, 6px)',
  background: 'var(--projections-color-bg, #ffffff)',
  color: 'var(--projections-color-fg, #1f2328)',
  boxShadow: 'var(--projections-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.08))',
}

/**
 * A revision's label as a small chip overlaid on its pane (top-left by
 * default), so labels take no height from the renderer. It ignores the
 * pointer, so the renderer underneath stays clickable.
 */
export function PaneLabel({
  side,
  children,
  id,
  corner = 'left',
  as: Element = 'span',
  className,
  style,
}: {
  side: Side
  children: ReactNode
  id?: string
  corner?: 'left' | 'right'
  as?: 'span' | 'h3'
  className?: string
  style?: CSSProperties
}) {
  return (
    <Element
      id={id}
      className={className ?? 'ph-pane-label'}
      data-side={side}
      style={{
        ...labelStyle,
        position: 'absolute',
        top: 8,
        ...(corner === 'left' ? {left: 8} : {right: 8}),
        zIndex: 1,
        pointerEvents: 'none',
        ...style,
      }}
      {...titleOf(children)}
    >
      <RevisionHeading side={side} label={children} />
    </Element>
  )
}

/** A long revision name is cut to fit; the whole name shows on hover. */
const titleOf = (label: ReactNode) => (typeof label === 'string' ? {title: label} : {})

/**
 * A revision's label as a chip in a slim strip above its pane (`ProjectionStage`'s `paneLabels: 'chips'`): no band
 * surface or rule, just the chip on the stage's background, so it reads as a tag on the pane rather than a header. The
 * strip is `paneGeometry.band` tall, so the chip never covers the renderer's content. `inset` lines the chip up with
 * where the renderer's content starts (or ends, for a right-hand chip).
 */
export function PaneChip({
  side,
  children,
  id,
  align,
  inset,
  as: Element = 'span',
  className,
}: {
  side: Side
  children: ReactNode
  id: string
  align: 'left' | 'right'
  inset: number
  as?: 'span' | 'h3'
  className: string
}) {
  return (
    <div
      data-pane-chip-strip=""
      style={{
        display: 'flex',
        flex: 'none',
        alignItems: 'flex-start',
        justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
        boxSizing: 'border-box',
        minWidth: 0,
        height: paneGeometry.band,
        paddingTop: chipTop,
        paddingInline: inset,
        pointerEvents: 'none',
      }}
    >
      <Element
        id={id}
        className={className}
        data-side={side}
        data-pane-chip=""
        style={{
          ...labelStyle,
          boxSizing: 'border-box',
          display: 'block',
          maxWidth: '100%',
          height: chipHeight,
          lineHeight: `${chipHeight - 2}px`,
          padding: '0 7px',
          boxShadow: 'none',
          // A host can restyle chips, for example as its own branch tags.
          background: 'var(--ph-pane-chip-bg, var(--projections-color-surface-header, #f6f8fa))',
          color: 'var(--ph-pane-chip-fg, var(--projections-color-fg, #1f2328))',
          border: 'var(--ph-pane-chip-border, 1px solid var(--projections-color-border, #d1d9e0))',
          fontWeight: 'var(--ph-pane-chip-weight, 600)' as CSSProperties['fontWeight'],
        }}
        {...titleOf(children)}
      >
        <RevisionHeading side={side} label={children} />
      </Element>
    </div>
  )
}
/** The chip's height and its gap below the stage's top edge: the strip's remaining 2px sit between chip and frame. */
const chipHeight = 20
const chipTop = paneGeometry.band - chipHeight - 2

/**
 * A revision's label as a slim header band above its pane (side by side and swipe), so the label never covers the
 * renderer's content: the band surface with a divider rule, in the token set's shared surface scale. Band and frame
 * sit inside one pane card (`paneCard`), whose single edge is the outline of both. `hidden` keeps the band only for
 * assistive technology: it takes no space and still names its pane.
 */
export function PaneBand({
  side,
  children,
  id,
  align,
  as: Element = 'span',
  className,
  hidden = false,
}: {
  side: Side
  children: ReactNode
  id: string
  align: 'left' | 'right'
  as?: 'span' | 'h3'
  className: string
  hidden?: boolean
}) {
  if (hidden) {
    return (
      <Element id={id} className={className} data-side={side} data-pane-band="hidden" style={srOnly}>
        <RevisionHeading side={side} label={children} />
      </Element>
    )
  }
  return (
    <Element
      id={id}
      className={className}
      data-side={side}
      data-pane-band=""
      style={{
        display: 'flex',
        flex: 'none',
        alignItems: 'center',
        justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
        boxSizing: 'border-box',
        minWidth: 0,
        // The card's top edge is the band's other pixel.
        height: paneGeometry.band - 1,
        margin: 0,
        padding: '0 10px',
        fontSize: '0.8em',
        fontWeight: 600,
        lineHeight: 1.5,
        color: 'var(--projections-color-fg, #1f2328)',
        background: 'var(--projections-color-surface-header, #f6f8fa)',
        // The pane card around band and frame draws the outer edge; the band only rules itself off from the frame.
        borderBottom: '1px solid var(--projections-color-divider, #818b98)',
      }}
    >
      <span
        style={{minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}
        // A long revision name is cut to fit; the whole name shows on hover.
        {...(typeof children === 'string' ? {title: children} : {})}
      >
        <RevisionHeading side={side} label={children} />
      </span>
    </Element>
  )
}
