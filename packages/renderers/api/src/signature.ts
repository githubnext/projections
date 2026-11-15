import type {Entity} from '@githubnext/projections-schemas'

export type Side = 'before' | 'after'

/** A run of signature text: in both revisions, or only in the before or after one. */
export interface Segment {
  text: string
  kind: 'same' | 'removed' | 'added'
}

/** A run of one revision's signature, marked when the other revision lacks it. */
export interface Token {
  text: string
  changed: boolean
}

const tokenPattern = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu
/** Above this many token pairs the signatures are compared as wholes. */
const tokenBudget = 250_000

function tokenize(text: string): string[] {
  return text.match(tokenPattern) ?? []
}

/**
 * Two signatures merged into one sequence of shared, removed and added runs,
 * following their longest common token subsequence; removals come before the
 * additions that replace them. Signatures too long to compare cheaply are one
 * removal and one addition.
 */
export function signatureSegments(before: string, after: string): Segment[] {
  const a = tokenize(before),
    b = tokenize(after)
  const segments: Segment[] = []
  const push = (text: string, kind: Segment['kind']) => {
    const last = segments.at(-1)
    if (last?.kind === kind) last.text += text
    else if (text) segments.push({text, kind})
  }
  if (a.length * b.length > tokenBudget) {
    push(before, 'removed')
    push(after, 'added')
    return segments
  }
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  let i = 0,
    j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i]!, 'same')
      i++
      j++
    } else if (i < a.length && (j === b.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) push(a[i++]!, 'removed')
    else push(b[j++]!, 'added')
  }
  return segments
}

/** One revision's signature as runs, marking what the other revision lacks. */
export function signatureTokens(segments: readonly Segment[], side: Side): Token[] {
  const own = side === 'before' ? 'removed' : 'added'
  return segments
    .filter(segment => segment.kind === 'same' || segment.kind === own)
    .map(segment => ({text: segment.text, changed: segment.kind !== 'same'}))
}

/**
 * How a changed signature reads best: `inline`, one line with removed and
 * added runs in place, when it mostly survives (or only gains or loses one
 * run); `split`, a removed line above an added line, when most of it is
 * rewritten.
 */
export function signatureLayout(segments: readonly Segment[]): 'inline' | 'split' {
  const length = (kind: Segment['kind']) => segments.reduce((sum, segment) => (segment.kind === kind ? sum + segment.text.length : sum), 0)
  const same = length('same')
  if (!same) return 'split'
  const changes = segments.filter(segment => segment.kind !== 'same').length
  return changes <= 1 || same >= Math.max(same + length('removed'), same + length('added')) / 2 ? 'inline' : 'split'
}

export function signatureOf(entity: Entity): string {
  return typeof entity.data?.signature === 'string' ? entity.data.signature : entity.kind
}
