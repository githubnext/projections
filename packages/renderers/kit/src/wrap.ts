/**
 * Balanced wrapping for rows of items (pills, chips, tags): as few lines as
 * greedy wrapping needs at the available width, then lines as close to the
 * same width as possible, never with a later line longer than an earlier one.
 * Item order is kept. CSS `text-wrap: balance` works only on inline text and
 * doesn't promise a top-heavy result, so renderers place items with this.
 */
export interface BalancedWrap {
  /** Item indices on each line, in order. */
  lines: number[][]
  /** Each line's width: its items plus the gaps between them. */
  widths: number[]
}

const lineWidth = (widths: readonly number[], start: number, end: number, gap: number) => {
  let total = 0
  for (let index = start; index < end; index++) total += widths[index]!
  return total + gap * Math.max(0, end - start - 1)
}

/** Greedy left-to-right wrapping at `limit`: each line takes items while they fit. An item wider than `limit` gets a line of its own. */
export function greedyWrap(widths: readonly number[], gap: number, limit: number): number[][] {
  const lines: number[][] = []
  let line: number[] = []
  let used = 0
  widths.forEach((width, index) => {
    const next = line.length ? used + gap + width : width
    if (line.length && next > limit + 1e-6) {
      lines.push(line)
      line = [index]
      used = width
    } else {
      line.push(index)
      used = next
    }
  })
  if (line.length) lines.push(line)
  return lines
}

const describe = (lines: number[][], widths: readonly number[], gap: number): BalancedWrap => ({
  lines,
  widths: lines.map(line => lineWidth(widths, line[0]!, line.at(-1)! + 1, gap)),
})

const topHeavy = (lineWidths: readonly number[]) =>
  lineWidths.every((width, index) => index === 0 || lineWidths[index - 1]! >= width - 1e-6)

/**
 * Wraps `widths` (each item's width, in order) into as few lines as greedy
 * wrapping needs within `available`, then narrows the lines to the smallest
 * maximum width that still needs no more lines. Greedy filling at that width
 * keeps earlier lines at least as long as later ones; where it can't (an item
 * order that forces a longer last line), the break set with the smallest
 * widest line among the top-heavy ones is used, and if none is top-heavy,
 * the narrowest.
 */
export function balancedWrap(widths: readonly number[], gap: number, available: number): BalancedWrap {
  if (!widths.length) return {lines: [], widths: []}
  const greedy = greedyWrap(widths, gap, available)
  const count = greedy.length
  if (count === 1) return describe(greedy, widths, gap)
  // Every line width a break set can produce is a contiguous run's width: the smallest that still gives `count` lines is exact.
  const candidates = new Set<number>()
  const widest = Math.max(...widths)
  for (let start = 0; start < widths.length; start++) {
    for (let end = start + 1; end <= widths.length; end++) {
      const width = lineWidth(widths, start, end, gap)
      if (width >= widest - 1e-6 && width <= Math.max(available, widest) + 1e-6) candidates.add(width)
    }
  }
  // Greedy line count only falls as the limit grows: binary search for the smallest candidate that keeps `count` lines.
  const sorted = [...candidates].sort((a, b) => a - b)
  let low = 0,
    high = sorted.length - 1,
    best = greedy
  while (low <= high) {
    const middle = (low + high) >> 1
    const lines = greedyWrap(widths, gap, sorted[middle]!)
    if (lines.length <= count) {
      best = lines
      high = middle - 1
    } else low = middle + 1
  }
  const balanced = describe(best, widths, gap)
  if (topHeavy(balanced.widths)) return balanced
  return breakSets(widths, gap, best.length, Math.max(available, widest)) ?? balanced
}

/** Every way to break `widths` into `count` lines no wider than `limit`: the top-heavy set with the narrowest widest line (then the most even), or the narrowest overall. */
function breakSets(widths: readonly number[], gap: number, count: number, limit: number): BalancedWrap | undefined {
  let heavy: BalancedWrap | undefined
  let any: BalancedWrap | undefined
  const score = (wrap: BalancedWrap) => [Math.max(...wrap.widths), wrap.widths[0]! - wrap.widths.at(-1)!] as const
  const better = (a: BalancedWrap, b: BalancedWrap | undefined) => {
    if (!b) return true
    const [aMax, aSpread] = score(a),
      [bMax, bSpread] = score(b)
    return aMax < bMax - 1e-6 || (Math.abs(aMax - bMax) <= 1e-6 && aSpread < bSpread - 1e-6)
  }
  const visit = (start: number, lines: number[][]) => {
    if (lines.length === count - 1) {
      if (start >= widths.length) return
      const last = Array.from({length: widths.length - start}, (_, index) => start + index)
      const wrap = describe([...lines, last], widths, gap)
      if (wrap.widths.some(width => width > limit + 1e-6 && wrap.lines[wrap.widths.indexOf(width)]!.length > 1)) return
      if (topHeavy(wrap.widths) && better(wrap, heavy)) heavy = wrap
      if (better(wrap, any)) any = wrap
      return
    }
    for (let end = start + 1; end <= widths.length - (count - 1 - lines.length); end++) {
      if (lineWidth(widths, start, end, gap) > limit + 1e-6 && end - start > 1) break
      visit(end, [...lines, Array.from({length: end - start}, (_, index) => start + index)])
    }
  }
  // The search is exhaustive; keep it to rows a renderer actually wraps.
  if (widths.length > 40 || count > 6) return undefined
  visit(0, [])
  return heavy ?? any
}

/** Characters a long identifier or value breaks after first, in order of preference: `_ . / - , :`, then spaces. */
const breakAfter = /[_./\-,:\s]/u

/**
 * Data text shown whole on lines of at most `limit` characters: words fill
 * each line, and a word longer than a line breaks after the last `_ . / - , :`
 * that fits (so `aws_cloudwatch_metric_alarm` reads `aws_cloudwatch_` then
 * `metric_alarm`), or, with none, at the limit. Nothing is dropped: joining
 * the lines gives the text back (spaces at a break are kept at the end of
 * their line). An empty text is one empty line.
 */
export function wrapText(text: string, limit: number): string[] {
  const room = Math.max(1, Math.floor(limit))
  const lines: string[] = []
  let rest = text
  while (rest.length > room) {
    let cut = -1
    for (let index = room; index > 0; index--) {
      if (breakAfter.test(rest[index - 1]!)) {
        cut = index
        break
      }
    }
    // A break too near the start would leave a sliver: break at the limit instead.
    if (cut < Math.ceil(room / 3)) cut = room
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  lines.push(rest)
  return lines
}
