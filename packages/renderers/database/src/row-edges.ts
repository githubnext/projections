import type {FrameColumn} from './frame.js'

/** Where a row sits in its card: first (under the header) or last (on the card's bottom edge). */
export interface RowPlace {
  first: boolean
  last: boolean
}

/** Each row's place in its card, from the rows' tops. */
export function rowPlaces(columns: readonly FrameColumn[]): Map<string, RowPlace> {
  const sorted = columns.toSorted((a, b) => a.top - b.top)
  return new Map(sorted.map((row, index) => [row.change.id, {first: index === 0, last: index === sorted.length - 1}]))
}

/**
 * A row's place as attributes, for the one line between two rows (see diff.css): a changed row draws the lines on
 * both its sides in its own hue, over the header's line when it is first and over the card's edge when it is last.
 */
export function placeAttributes(place: RowPlace | undefined): Record<string, string> {
  return {...(place?.first ? {'data-first': ''} : {}), ...(place?.last ? {'data-last': ''} : {})}
}
