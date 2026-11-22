import type {CSSProperties, KeyboardEvent} from 'react'
import {changeMark, describeChange, isChanged, type EmphasisOf} from '@githubnext/projections-renderer-kit'
import {signed} from './timeline.js'
import type {Series} from './series.js'

/** No status: composition rows and unchanged languages still reserve the status cell. */
export const unchanged = {status: 'unchanged'} as const

export interface PresentationOptions {
  diff: boolean
  /** What the rows are, for the charts' labels: `language`, `line kind`, or a generic measurement's kind. */
  grouping: string
  noun: string
  highlighting: number
  emphasis: EmphasisOf
  selectedId: string | null
  onSelect: (id: string | null) => void
  number: (value: number) => string
}

/** How every chart counts, words, marks and emphasizes a row. */
export function rowPresentation({diff, grouping, noun, highlighting, emphasis, selectedId, onSelect, number}: PresentationOptions) {
  const count = (value: number) => number(Math.round(value))
  const value = (item: Series) => item.value
  const signedDelta = (delta: number) => (delta ? `, ${signed(delta, number)}` : '')
  // Each language's decoration follows its own step; the composition's parts follow the host's highlighting.
  const emphasisOf = (item: Series) =>
    item.after - item.before === 0
      ? 0
      : (item.entity ? emphasis({status: item.status, renamed: Boolean(item.renamed)}, item.id) : highlighting) * item.emphasis
  /** A language's status while its own step is emphasized. */
  const statusEmphasis = (item: Series) => (item.entity ? emphasis({status: item.status, renamed: Boolean(item.renamed)}, item.id) : 0)
  const described = (item: Series) => (item.entity && isChanged(item) && statusEmphasis(item) > 0.01 ? `, ${describeChange(item)}` : '')
  /** How strongly diff mode marks a row's change: its own emphasis for a language, the host's highlighting for a line kind. */
  const regionEmphasis = (item: Series) => (item.change === 'unchanged' ? 0 : item.entity ? statusEmphasis(item) : highlighting)
  /** Diff mode's marking of a row (fill and same-hue edge, as strong as its emphasis); nothing outside diff mode. */
  const region = (item: Series) =>
    diff && item.change !== 'unchanged' ? {...changeMark(item.change), style: {'--emphasis': regionEmphasis(item)} as CSSProperties} : {}
  // Diff mode states a line kind's change in words too; elsewhere only languages carry a status.
  const rowStatus = (item: Series) => (item.entity ? item : diff && item.change !== 'unchanged' ? {status: item.status} : unchanged)
  const rowStatusEmphasis = (item: Series) => (item.entity ? statusEmphasis(item) : diff ? regionEmphasis(item) : 0)
  /** A row's accessible counts: the After count, what it was, and the signed change; a removed row only what it was. */
  const counted = (item: Series) => {
    const delta = item.after - item.before
    if (!diff) return `${count(value(item))} ${noun}${signedDelta(delta)}`
    if (item.change === 'removed') return `was ${count(item.before)} ${noun}${signedDelta(delta)}`
    return `${count(item.after)} ${noun}${item.before && delta ? `, was ${count(item.before)}` : ''}${signedDelta(delta)}`
  }
  const labelText = (item: Series) => (item.previousLabel ? `${item.label}, was ${item.previousLabel}` : item.label)
  return {
    diff,
    noun,
    /** What the rows are grouped by, for the charts' labels. */
    grouping,
    selectedId,
    onSelect,
    number,
    count,
    value,
    signedDelta,
    emphasisOf,
    statusEmphasis,
    described,
    region,
    rowStatus,
    rowStatusEmphasis,
    counted,
    labelText,
  }
}

export type RowPresentation = ReturnType<typeof rowPresentation>

/** A slice's semantics: a toggle button when it addresses an entity, otherwise an image. */
export function sliceSemantics(item: Series, {selectedId, onSelect}: Pick<RowPresentation, 'selectedId' | 'onSelect'>) {
  if (!item.entity) return {role: 'img'}
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selectedId === item.id,
    onClick: () => onSelect(item.id),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect(item.id)
      }
    },
  }
}

export interface Arc {
  start: number
  end: number
}

/** Slices of one ring, in series order: a ring of `amount`s that add up to a whole turn. */
export function ring(shown: readonly Series[], amountOf: (item: Series) => number, sum: number): Map<string, Arc> {
  let offset = -Math.PI / 2
  return new Map(
    shown
      .filter(item => amountOf(item) > 0)
      .map(item => {
        const start = offset
        offset += sum > 0 ? (amountOf(item) / sum) * Math.PI * 2 : 0
        return [item.id, {start, end: offset}] as const
      }),
  )
}
