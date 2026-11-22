import type {DiffOp} from './diff.js'

/**
 * Shortest edit script between two integer sequences (Myers, 1986), or
 * `undefined` when it would exceed `maxDistance`. Each round keeps only the
 * diagonals it reached, so memory is O(D²) rather than O((N + M) · D).
 */
export function myers(a: Int32Array, b: Int32Array, maxDistance: number): DiffOp[] | undefined {
  const n = a.length,
    m = b.length
  const limit = Math.min(maxDistance, n + m)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  const trace: Int32Array[] = []
  let distance = -1
  for (let d = 0; d <= limit && distance < 0; d++) {
    trace.push(v.slice(offset - d, offset + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        distance = d
        break
      }
    }
  }
  if (distance < 0) return undefined
  const ops: DiffOp[] = []
  let x = n,
    y = m
  for (let d = distance; d > 0; d--) {
    // `trace[d]` holds the furthest reach after round d - 1, for diagonals -d..d.
    const previous = trace[d]!
    const at = (k: number) => previous[k + d]!
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const priorK = down ? k + 1 : k - 1
    const priorX = at(priorK),
      priorY = priorX - priorK
    while (x > priorX && y > priorY) ops.push({kind: 'equal', old: --x, new: --y})
    if (down) ops.push({kind: 'insert', new: --y})
    else ops.push({kind: 'delete', old: --x})
  }
  while (x > 0 && y > 0) ops.push({kind: 'equal', old: --x, new: --y})
  return ops.toReversed()
}
