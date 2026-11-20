import {useRef} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import type {Side} from '../modes.js'
import {paneGeometry} from './arrangement.js'
import {ChipText} from './chip-text.js'
import {useWholePixels} from './whole-pixels.js'

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
 * A revision's label as a chip overlaid on its pane's frame (`ProjectionStage`'s `paneLabels: 'chips'`): it sits on
 * the renderer's own stage, over the frame's top corner, and takes no height from it. `inset` lines it up with where
 * the renderer's content starts (or ends, for a right-hand chip), and it sits as far below the frame's top; the stage
 * measures it over the frame and sends it as the frame's `stage-cover`, with the band it takes (`paneChipClearance`)
 * as its `stage-inset-top`, so a renderer that honours them keeps its content clear of the chip. It takes the pointer,
 * as the playback bar does, so hovering it shows its whole label (`title`: a cut subject and the revision's age); the
 * renderer's content is kept clear of it, and the stage around it still reaches the frame.
 *
 * A solid box in the stage's playback bar's own surface, edge and corners (`UtilityArea`'s `--ph-utility-bg`,
 * `--ph-utility-border` and `--ph-utility-radius`), 28px tall with 10px of padding, and its text: the revision's name
 * in mono at regular weight in the bar's muted text colour (`--ph-utility-muted`), then its commit subject in the text
 * face (`ChipText`). Its text is centred by cap height.
 * A host restyles the chip alone with `--ph-pane-chip-bg`, `--ph-pane-chip-border`, `--ph-pane-chip-radius`,
 * `--ph-pane-chip-fg` (the subject) and `--ph-pane-chip-name`.
 */
export function PaneChip({
  side,
  children,
  id,
  align,
  inset,
  maxWidth,
  as: Element = 'span',
  className,
}: {
  side: Side
  children: ReactNode
  id: string
  align: 'left' | 'right'
  inset: number
  /** The widest it may be, CSS px (swipe's chips keep to their halves, so they never meet); by default its pane less its insets. */
  maxWidth?: number | undefined
  as?: 'span' | 'h3'
  className: string
}) {
  // A pane under a host's header can rest at a fractional offset: the chip keeps its edges on whole pixels.
  const chip = useRef<HTMLHeadingElement & HTMLSpanElement>(null)
  useWholePixels(chip)
  return (
    <Element
      ref={chip}
      id={id}
      className={className}
      data-side={side}
      data-pane-chip=""
      data-stage-cover=""
      style={{
        position: 'absolute',
        top: chipTop,
        ...(align === 'left' ? {left: inset} : {right: inset}),
        zIndex: 1,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: maxWidth ?? `calc(100% - ${2 * inset}px)`,
        height: chipHeight,
        margin: 0,
        padding: '0 10px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        fontSize: 'var(--projections-font-size-xs, 12px)',
        fontWeight: 400,
        lineHeight: 1,
        borderRadius: 'var(--ph-pane-chip-radius, var(--ph-utility-radius, var(--projections-radius, 8px)))',
        pointerEvents: 'auto',
        cursor: 'default',
        // The playback bar's look (`UtilityArea`'s `--ph-utility-*`), so the stage's chips and bar read as one family.
        background: 'var(--ph-pane-chip-bg, var(--ph-utility-bg, var(--projections-color-surface-header, #f6f8fa)))',
        color: 'var(--ph-pane-chip-fg, var(--projections-color-fg-subtle, #818b98))',
        border: 'var(--ph-pane-chip-border, var(--ph-utility-border, 1px solid var(--projections-color-divider, #d1d9e0)))',
      }}
      {...titleOf(children)}
    >
      <span style={srOnly}>{side === 'before' ? 'Before revision: ' : 'After revision: '}</span>
      <ChipText label={children} words={typeof children === 'string' && genericLabels.has(children.trim())} hidden={srOnly} />
    </Element>
  )
}
/** The chip's height and its gap below the frame's top edge, CSS px: as much as its inset at the side. */
const chipHeight = 28
const chipTop = 12
/**
 * The space a pane chip takes at the top of its frame, CSS px: its gap, its height and as much again below it, which
 * the stage measures and sends to the frames chips overlay as their `stage-inset-top` theme token.
 */
export const paneChipClearance = chipTop + chipHeight + chipTop

/**
 * A revision's label as a slim header band above its pane (side by side and swipe), so the label never covers the
 * renderer's content: the band surface with a divider rule, in the token set's shared surface scale. Band and frame
 * sit inside one pane card (`paneCard`), whose single edge is the outline of both. `hidden` keeps the band only for
 * assistive technology: it takes no space and still names its pane. A host restyles it with `--pj-pane-band-bg`,
 * `--pj-pane-band-fg` and `--pj-pane-band-rule`, as the default UI does to match its own bands.
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
        // A host's chrome restyles the band to match its own bands (the default UI's header surface and divider, which an
        // app theme lays flat on the app's own color); without one, it takes the theme tokens.
        color: 'var(--pj-pane-band-fg, var(--projections-color-fg, #1f2328))',
        background: 'var(--pj-pane-band-bg, var(--projections-color-surface-header, #f6f8fa))',
        // The pane card around band and frame draws the outer edge; the band only rules itself off from the frame.
        borderBottom: '1px solid var(--pj-pane-band-rule, var(--projections-color-divider, #818b98))',
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
