// Arranging sibling circles around their centre, stably and without overlap.
import {packSiblings} from 'd3-hierarchy'

/** Siblings past this many pack with d3's front-chain packing instead of relaxation, which is quadratic. */
const relaxLimit = 160

/** A 32-bit FNV-1a hash, for a stable bearing per key. */
function bearing(key: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0
  return hash
}

export interface Circle {
  x: number
  y: number
  r: number
  key: string
}

/** Pushes overlapping circles apart (heavier ones move less); whether anything moved. */
export function separate(circles: readonly Circle[], gap: number): boolean {
  let moved = false
  const n = circles.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = circles[i]!,
        b = circles[j]!
      let dx = b.x - a.x,
        dy = b.y - a.y
      const minimum = a.r + b.r + gap
      const squared = dx * dx + dy * dy
      if (squared >= (minimum - 1e-9) * (minimum - 1e-9)) continue
      let distance = Math.sqrt(squared)
      if (distance < 1e-9) {
        // Coincident centres separate along a fixed direction, so the result never depends on chance.
        dx = 1
        dy = 0
        distance = 1e-9
      }
      const push = (minimum - distance) / distance
      const total = a.r * a.r + b.r * b.r || 1
      const share = (b.r * b.r) / total
      a.x -= dx * push * share
      a.y -= dy * push * share
      b.x += dx * push * (1 - share)
      b.y += dy * push * (1 - share)
      moved = true
    }
  }
  return moved
}

/**
 * Arranges sibling circles around the origin: deterministic relaxation with
 * gravity towards the centre and collision resolution. Each circle starts on
 * its own bearing (a hash of its key), so it settles on the same side however
 * its siblings change, and a resized or removed sibling only nudges its
 * neighbours. With an `aspect` (width / height) other than 1, gravity is
 * weaker along the long side and the circles fill an area of that shape, the
 * way the original Repo Visualization reflowed its top level.
 */
export function arrange(circles: Circle[], aspect: number, gap: number, previous?: ReadonlyMap<string, {x: number; y: number}>): void {
  const n = circles.length
  if (n < 2) {
    for (const circle of circles) {
      circle.x = 0
      circle.y = 0
    }
    return
  }
  const stretch = Math.sqrt(Math.max(0.25, Math.min(4, aspect)))
  if (n > relaxLimit) {
    // Too many to relax cheaply: d3's front-chain packing, in key order, stretched to the aspect.
    const padded = circles.map(circle => ({x: 0, y: 0, r: circle.r + gap / 2}))
    packSiblings(padded)
    padded.forEach((circle, index) => {
      circles[index]!.x = circle.x * stretch
      circles[index]!.y = circle.y / stretch
    })
    for (let pass = 0; pass < 40 && separate(circles, gap); pass++);
    return
  }
  const spread = Math.sqrt(circles.reduce((sum, circle) => sum + circle.r * circle.r, 0))
  // A warm start continues from where the circles were (the previous comparison stage): they only settle
  // around what changed, so unchanged circles barely move. New circles start on their bearing.
  const warm = previous !== undefined && circles.some(circle => previous.has(circle.key))
  for (const circle of circles) {
    const known = warm ? previous.get(circle.key) : undefined
    if (known) {
      circle.x = known.x
      circle.y = known.y
      continue
    }
    const angle = (bearing(circle.key) / 0x100000000) * 2 * Math.PI
    circle.x = Math.cos(angle) * spread * (warm ? 0.5 : stretch)
    circle.y = (Math.sin(angle) * spread) / (warm ? 2 : stretch)
  }
  const iterations = warm ? 60 : aspect === 1 ? 60 : 180
  const strength = warm ? 0.4 : 1
  const skew = Math.min(40, Math.max(aspect, 1 / aspect) ** 3)
  const gx = aspect >= 1 ? 0.15 / skew : 0.15,
    gy = aspect >= 1 ? 0.15 : 0.15 / skew
  for (let iteration = 0; iteration < iterations; iteration++) {
    const cooling = strength * (1 - iteration / iterations)
    for (const circle of circles) {
      circle.x -= circle.x * gx * cooling
      circle.y -= circle.y * gy * cooling
    }
    separate(circles, gap)
    separate(circles, gap)
  }
  for (let pass = 0; pass < 1000 && separate(circles, gap); pass++);
}
