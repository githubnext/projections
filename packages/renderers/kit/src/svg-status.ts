// An SVG status line's metrics (`SvgChangeStatus`), so a card can reserve its width before it is drawn.
import type {ChangeStatus} from '@githubnext/projections-schemas'
import {variedBeyond} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {StatusPart} from './emphasis.js'

/** A row's change, as a status line shows it. */
export type StatusChange = {status: ChangeStatus; renamed?: boolean | undefined; varied?: EntityChange<unknown>['varied'] | undefined}

/**
 * Icon size, gap after an icon, gap between parts of an SVG status line, and the estimated advance of a status
 * word's character at the type scale's default size (12), in user units.
 */
export const svgIcon = 12,
  svgIconGap = 2.5,
  svgPartGap = 10,
  svgWordAdvance = 6.5

/**
 * The width an SVG status line (`SvgChangeStatus`) takes with its words estimated rather than measured: per part an
 * icon, a gap and the word, parts a gap apart, then the volatile marker. A card reserves it so its status always
 * fits; `textScale` is the theme's extra-small type size over the default 12.
 */
export function svgStatusWidth(parts: readonly StatusPart[], change?: StatusChange, textScale = 1): number {
  if (!parts.length) return 0
  const words = parts.reduce((sum, part) => sum + svgIcon + svgIconGap + part.label.length * svgWordAdvance * textScale, 0)
  return words + svgPartGap * (parts.length - 1) + (change && variedBeyond(change) ? svgIconGap * 2 + svgIcon : 0)
}
