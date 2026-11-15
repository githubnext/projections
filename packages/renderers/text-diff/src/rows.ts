import {diffLines} from './diff.js'
import type {Line, LineDiff} from './diff.js'

export type LineKind = 'equal' | 'delete' | 'insert'

export interface Cell {
  kind: LineKind
  /** 1-based line number on this cell's side. */
  number: number
  text: string
  /** Shown when a line differs from a line on the other side only by its terminator. */
  ending?: string
  /** The line in words, marking those that differ from the line it replaces or is replaced by. */
  words?: Word[]
}

/** A run of a changed line's text, `changed` when the line it pairs with doesn't have it. */
export interface Word {
  text: string
  changed: boolean
}

export interface UnifiedRow {
  kind: LineKind
  old?: number
  new?: number
  text: string
  ending?: string
  words?: Word[]
}

export interface SplitRow {
  left?: Cell
  right?: Cell
}

const endingLabels: Record<Line['eol'], string> = {'': 'no newline at end', '\n': 'LF', '\r\n': 'CRLF', '\r': 'CR'}

export interface OutputDiff extends LineDiff {
  unified: UnifiedRow[]
  split: SplitRow[]
}

/** Longest line, in characters, whose words are compared. */
const wordLimit = 1000

/**
 * The words two paired lines don't share, for marking within the lines, or
 * `undefined` when they share too little for that to help (more than 60% of
 * either line changed) or nothing differs but the terminator.
 */
export function wordDiff(before: string, after: string): [Word[], Word[]] | undefined {
  if (before === after || before.length > wordLimit || after.length > wordLimit) return undefined
  const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
  const a = tokens(before),
    b = tokens(after)
  // Tokens hold no line breaks, so the line diff compares them one per line.
  const diff = diffLines(a.join('\n'), b.join('\n'))
  if (!diff.minimal) return undefined
  const left: Word[] = [],
    right: Word[] = []
  const push = (words: Word[], text: string, changed: boolean) => {
    const last = words.at(-1)
    if (last && last.changed === changed) last.text += text
    else words.push({text, changed})
  }
  for (const op of diff.ops) {
    if (op.kind !== 'insert') push(left, a[op.old]!, op.kind === 'delete')
    if (op.kind !== 'delete') push(right, b[op.new]!, op.kind === 'insert')
  }
  const share = (words: Word[], text: string) =>
    words.filter(word => word.changed).reduce((total, word) => total + word.text.length, 0) / Math.max(1, text.length)
  if (share(left, before) > 0.6 || share(right, after) > 0.6) return undefined
  return [left, right]
}

/** The line diff of one output, in unified rows and aligned split rows. */
export function outputDiff(before: string, after: string): OutputDiff {
  const diff = diffLines(before, after)
  const unified: UnifiedRow[] = []
  const split: SplitRow[] = []
  let deletes: Cell[] = [],
    inserts: Cell[] = []
  const flush = () => {
    // A line whose text appears on the other side of the same change differs only in its terminator.
    const texts = (cells: Cell[]) => new Set(cells.map(cell => cell.text))
    const oldTexts = texts(deletes),
      newTexts = texts(inserts)
    for (const cell of deletes) if (newTexts.has(cell.text)) cell.ending = endingLabels[diff.before[cell.number - 1]!.eol]
    for (const cell of inserts) if (oldTexts.has(cell.text)) cell.ending = endingLabels[diff.after[cell.number - 1]!.eol]
    for (let index = 0; index < Math.min(deletes.length, inserts.length); index++) {
      const words = wordDiff(deletes[index]!.text, inserts[index]!.text)
      if (words) [deletes[index]!.words, inserts[index]!.words] = words
    }
    const extra = (cell: Cell) => ({...(cell.ending ? {ending: cell.ending} : {}), ...(cell.words ? {words: cell.words} : {})})
    for (const cell of deletes) unified.push({kind: 'delete', old: cell.number, text: cell.text, ...extra(cell)})
    for (const cell of inserts) unified.push({kind: 'insert', new: cell.number, text: cell.text, ...extra(cell)})
    for (let index = 0; index < Math.max(deletes.length, inserts.length); index++) {
      const left = deletes[index],
        right = inserts[index]
      split.push({...(left ? {left} : {}), ...(right ? {right} : {})})
    }
    deletes = []
    inserts = []
  }
  for (const op of diff.ops) {
    if (op.kind === 'delete') deletes.push({kind: 'delete', number: op.old + 1, text: diff.before[op.old]!.text})
    else if (op.kind === 'insert') inserts.push({kind: 'insert', number: op.new + 1, text: diff.after[op.new]!.text})
    else {
      flush()
      const text = diff.before[op.old]!.text
      unified.push({kind: 'equal', old: op.old + 1, new: op.new + 1, text})
      split.push({left: {kind: 'equal', number: op.old + 1, text}, right: {kind: 'equal', number: op.new + 1, text}})
    }
  }
  flush()
  return {...diff, unified, split}
}
