// Where routes meet one side of a card.

/** Most space between the ports of neighbouring routes on one side of a card. */
export const portSpacing = 16
/** Least distance from a port to the corners of its side. */
export const portInset = 16

/**
 * Where `count` routes meet one side of a card (or a row), as offsets from
 * the side's middle, in order: spread evenly over a band centred on the side,
 * `spacing` apart at most and never closer than `inset` to its ends. One
 * route meets the middle.
 */
export function spreadPorts(count: number, length: number, spacing = portSpacing, inset = portInset): number[] {
  if (count <= 1) return count ? [0] : []
  const step = Math.min(spacing, Math.max(0, length - 2 * inset) / (count - 1))
  return Array.from({length: count}, (_, index) => (index - (count - 1) / 2) * step)
}
