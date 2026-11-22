// A word diff for the optional comparison of two generated passages (generated.ts; docs/design/generated-values.md).

/** One run of a word diff: text both passages share, or text only one has. */
export interface WordRun {
  /** The run's text, never empty: the `same` and `removed` runs spell `before`, the `same` and `added` runs `after`. */
  text: string
  /** `same` for text both passages have, `removed` for text only `before` has, `added` for text only `after` has. */
  op: 'same' | 'removed' | 'added'
}

/** The most tokens a passage may have to be word-diffed. */
const maxTokens = 2000

/**
 * A word diff of two passages, as runs in reading order (removed text before the text that replaced it), or
 * `undefined` when either is too long to compare. Words, spaces and punctuation are the tokens.
 */
export function wordDiff(before: string, after: string): WordRun[] | undefined {
  const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
  const a = tokens(before)
  const b = tokens(after)
  if (a.length > maxTokens || b.length > maxTokens) return undefined
  // Longest common subsequence, by suffix lengths.
  const width = b.length + 1
  const lengths = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] =
        a[i] === b[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
  const runs: WordRun[] = []
  const push = (text: string, op: WordRun['op']) => {
    const last = runs.at(-1)
    if (last?.op === op) last.text += text
    else runs.push({text, op})
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i++]!, 'same')
      j++
    } else if (j >= b.length || (i < a.length && lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) push(a[i++]!, 'removed')
    else push(b[j++]!, 'added')
  }
  return runs
}
