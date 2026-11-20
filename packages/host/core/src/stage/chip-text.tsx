import type {CSSProperties, ReactNode} from 'react'

/** A chip label's parts: the revision's name (an identifier), its commit subject, and its age. */
export interface ChipParts {
  name: string
  detail?: string | undefined
  when?: string | undefined
}

/** Splits a revision label (`name · detail · when`, see the Inspector's `revisions.ts`) into its parts. */
export function chipParts(label: string): ChipParts {
  const parts = label.split(' · ')
  const name = parts.shift() ?? ''
  const when = parts.length && /\bago$|^just now$/.test(parts[parts.length - 1]!) ? parts.pop() : undefined
  return {name, detail: parts.length ? parts.join(' · ') : undefined, when}
}

const mono = 'var(--projections-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'
const hash = /^[0-9a-f]{7,}$/
/** The name's colour: the playback bar's text (its percent and step labels), muted. */
const nameColour = 'var(--ph-pane-chip-name, var(--ph-utility-muted, var(--projections-color-fg-muted, #59636e)))'
/** The subject's: one step more muted. */
const subjectColour = 'var(--ph-pane-chip-fg, var(--projections-color-fg-subtle, #818b98))'

/**
 * Text trimmed to its capitals and baseline (`text-box`), so the chip's box centres it by cap height: a capital E has
 * as much space above it as below. `grow` lets it shrink and end in an ellipsis.
 */
const trimmed = (style: CSSProperties, grow = false): CSSProperties =>
  ({
    display: 'block',
    flex: grow ? '0 1 auto' : 'none',
    minWidth: 0,
    whiteSpace: 'nowrap',
    ...(grow ? {overflowX: 'clip', overflowY: 'visible', textOverflow: 'ellipsis'} : {}),
    textBox: 'trim-both cap alphabetic',
    ...style,
  }) as CSSProperties

/**
 * A pane chip's text, as the playback bar draws its text (`--ph-utility-muted`, regular weight): the revision's name
 * in the monospace face, then its commit subject, unquoted and one step more muted, cut with an ellipsis when long. The age is left to the chip's tooltip and to assistive technology
 * (`hidden`), as is anything else a label says that the chip doesn't show. Labels that name a side in words (`Before`)
 * stay in the text face.
 */
export function ChipText({label, words, hidden}: {label: ReactNode; words: boolean; hidden: CSSProperties}): ReactNode {
  if (typeof label !== 'string') return label
  if (words) return <span style={trimmed({color: nameColour})}>{label}</span>
  const {name, detail, when} = chipParts(label)
  const subject = detail?.replace(/^"(.*)"$/, '$1')
  return (
    <>
      <span
        style={trimmed({
          fontFamily: mono,
          color: nameColour,
        })}
      >
        {name}
      </span>
      {subject && (
        // A ref's commit (`HEAD~30 · 57b6e797`) is an identifier too.
        <span style={trimmed(hash.test(subject) ? {fontFamily: mono, color: subjectColour} : {color: subjectColour}, true)}>{subject}</span>
      )}
      {when && <span style={hidden}>, {when}</span>}
    </>
  )
}
