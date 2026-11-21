/** One line of text and the terminator that ended it (`''` for a final line without one). */
export interface Line {
  text: string
  eol: '' | '\n' | '\r\n' | '\r'
}

export type DiffOp = {kind: 'equal'; old: number; new: number} | {kind: 'delete'; old: number} | {kind: 'insert'; new: number}

export interface LineDiff {
  before: Line[]
  after: Line[]
  /** Every line of both sides once, in order; within a changed run, deletions precede insertions. */
  ops: DiffOp[]
  /** False when the size guard replaced the changed middle wholesale instead of finding a minimal diff. */
  minimal: boolean
}

export interface DiffLimits {
  /** Upper bound on edit distance × lines compared, the work Myers' algorithm may do. */
  budget?: number
  /** Upper bound on the edit distance searched. */
  maxDistance?: number
}

import {myers} from './myers.js'

const defaultBudget = 40_000_000
const defaultMaxDistance = 2_000

/** Splits text into lines, keeping each line's terminator. A trailing terminator ends the last line rather than starting an empty one. */
export function splitLines(text: string): Line[] {
  const lines: Line[] = []
  const pattern = /\r\n|\n|\r/g
  let start = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push({text: text.slice(start, match.index), eol: match[0] as Line['eol']})
    start = match.index + match[0].length
  }
  if (start < text.length) lines.push({text: text.slice(start), eol: ''})
  return lines
}

/** Within each run of changes, deletions first: the conventional reading order of a diff. */
function orderRuns(ops: DiffOp[]): DiffOp[] {
  const result: DiffOp[] = []
  let deletes: DiffOp[] = [],
    inserts: DiffOp[] = []
  const flush = () => {
    result.push(...deletes, ...inserts)
    deletes = []
    inserts = []
  }
  for (const op of ops) {
    if (op.kind === 'delete') deletes.push(op)
    else if (op.kind === 'insert') inserts.push(op)
    else {
      flush()
      result.push(op)
    }
  }
  flush()
  return result
}

/**
 * Line diff of two texts. Lines are equal only when their text and their
 * terminator match, so line-ending and final-newline changes show as changed
 * lines. Common leading and trailing lines are trimmed in linear time; the
 * middle is diffed with Myers' algorithm, within a work budget beyond which
 * the middle is shown as wholly replaced (`minimal: false`).
 */
export function diffLines(beforeText: string, afterText: string, limits: DiffLimits = {}): LineDiff {
  const before = splitLines(beforeText),
    after = splitLines(afterText)
  const ids = new Map<string, number>()
  const encode = (lines: Line[]) =>
    Int32Array.from(lines, line => {
      const key = `${line.eol}\u0000${line.text}`
      let id = ids.get(key)
      if (id === undefined) ids.set(key, (id = ids.size))
      return id
    })
  const a = encode(before),
    b = encode(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length,
    endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const ops: DiffOp[] = []
  for (let index = 0; index < start; index++) ops.push({kind: 'equal', old: index, new: index})
  const middleA = a.subarray(start, endA),
    middleB = b.subarray(start, endB)
  const span = middleA.length + middleB.length
  const maxDistance = Math.min(limits.maxDistance ?? defaultMaxDistance, Math.floor((limits.budget ?? defaultBudget) / Math.max(1, span)))
  let middle = !middleA.length || !middleB.length ? undefined : myers(middleA, middleB, maxDistance)
  const minimal = middle !== undefined || !middleA.length || !middleB.length
  middle ??= [
    ...Array.from(middleA, (_, index): DiffOp => ({kind: 'delete', old: index})),
    ...Array.from(middleB, (_, index): DiffOp => ({kind: 'insert', new: index})),
  ]
  for (const op of middle) {
    ops.push(
      op.kind === 'equal'
        ? {kind: 'equal', old: op.old + start, new: op.new + start}
        : op.kind === 'delete'
          ? {kind: 'delete', old: op.old + start}
          : {kind: 'insert', new: op.new + start},
    )
  }
  for (let index = 0; index < a.length - endA; index++) ops.push({kind: 'equal', old: endA + index, new: endB + index})
  return {before, after, ops: orderRuns(ops), minimal}
}
