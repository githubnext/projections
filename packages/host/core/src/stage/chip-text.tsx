import type {CSSProperties, ReactNode} from 'react'
import {parseRevisionLabel} from '../revision-label.js'

const mono = 'var(--projections-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'
const hash = /^[0-9a-f]{7,}$/u
/** The name's colour: the playback bar's text (its percent and step labels), muted. */
const nameColour = 'var(--ph-pane-chip-name, var(--ph-utility-muted, var(--projections-color-fg-muted, #59636e)))'
/**
 * The subject's: the same muted text, in the text face, so the name (an identifier, in mono) and the subject read
 * apart while both keep 4.5:1 on the chip's fill (a subtler colour fell below it).
 */
const subjectColour = 'var(--ph-pane-chip-fg, var(--ph-utility-muted, var(--projections-color-fg-muted, #59636e)))'

/**
 * Text trimmed to its capitals and baseline (`text-box`), so the chip's box centres it by cap height: a capital E has
 * as much space above it as below. `grow` lets it shrink and end in an ellipsis.
 */
const trimmed = (style: CSSProperties, grow = false): CSSProperties => ({
  display: 'block',
  flex: grow ? '0 1 auto' : 'none',
  minWidth: 0,
  whiteSpace: 'nowrap',
  ...(grow ? {overflowX: 'clip', overflowY: 'visible', textOverflow: 'ellipsis'} : {}),
  textBox: 'trim-both cap alphabetic',
  ...style,
})

/**
 * A pane chip's text, as the playback bar draws its text (`--ph-utility-muted`, regular weight): the revision's name
 * in the monospace face, then its commit subject, unquoted, in the text face and the same muted colour, cut with an ellipsis when long. The age is left to the chip's tooltip and to assistive technology
 * (`hidden`), as is anything else a label says that the chip doesn't show. Labels that name a side in words (`Before`)
 * stay in the text face.
 */
export function ChipText({label, words, hidden}: {label: ReactNode; words: boolean; hidden: CSSProperties}): ReactNode {
  if (typeof label !== 'string') return label
  if (words) return <span style={trimmed({color: nameColour})}>{label}</span>
  const {name, detail, when} = parseRevisionLabel(label)
  const subject = detail?.replace(/^"(.*)"$/u, '$1')
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
