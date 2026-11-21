/** A line diff of two texts (longest common subsequence), as `-`, `+` and ` ` lines. */
export function lineDiff(before: string, after: string): {kind: ' ' | '-' | '+'; text: string}[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const table = Array.from({length: a.length + 1}, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const lines: {kind: ' ' | '-' | '+'; text: string}[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({kind: ' ', text: a[i]!})
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) lines.push({kind: '-', text: a[i++]!})
    else lines.push({kind: '+', text: b[j++]!})
  }
  while (i < a.length) lines.push({kind: '-', text: a[i++]!})
  while (j < b.length) lines.push({kind: '+', text: b[j++]!})
  return lines
}
