/** Digits needed for the largest line number of a text, for a stable gutter width. */
export function digits(count: number): number {
  return Math.max(1, String(Math.max(1, count)).length)
}

/** Unchanged lines kept around each change; longer unchanged runs fold into a gap. */
export const contextLines = 3

/** A run of rows to show, or a folded run of unchanged rows. */
export type Segment = {kind: 'rows'; start: number; end: number} | {kind: 'gap'; start: number; end: number}

/**
 * Folds unchanged runs longer than twice the context into gaps, keeping
 * `context` lines next to every change. `expanded` lists the start index of
 * gaps the reader opened. A gap that would hide fewer than two lines is shown.
 */
export function segments(changed: readonly boolean[], context = contextLines, expanded: ReadonlySet<number> = new Set()): Segment[] {
  const keep = changed.map(() => false)
  for (const [index, value] of changed.entries()) {
    if (!value) continue
    for (let at = Math.max(0, index - context); at <= Math.min(changed.length - 1, index + context); at++) keep[at] = true
  }
  const result: Segment[] = []
  let index = 0
  while (index < changed.length) {
    let end = index
    if (keep[index]) {
      while (end < changed.length && keep[end]) end++
    } else {
      while (end < changed.length && !keep[end]) end++
      if (end - index >= 2 && !expanded.has(index)) {
        result.push({kind: 'gap', start: index, end})
        index = end
        continue
      }
    }
    const last = result.at(-1)
    if (last?.kind === 'rows' && last.end === index) last.end = end
    else result.push({kind: 'rows', start: index, end})
    index = end
  }
  return result
}
