// The pixel analysis of optical insets, which runs in the page: it must stay self-contained.

/** Painted bounds in device pixels of the picture, sub-pixel at antialiased edges. */
export interface InkBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The painted bounds of what differs between two pictures of the same region: `[shown, hidden]` data URLs, the thing
 * drawn and not, counting only differences within `within` (device pixels of the picture), the thing's own box, so a
 * repaint elsewhere (a ring's antialiasing) is never taken for it. A row's or column's coverage is its strongest difference over the strongest anywhere, so an
 * antialiased edge row counts for the part of it that is covered, and the bounds land where the edge is.
 */
export function inkBounds([shownUrl, hiddenUrl, within]: [string, string, InkBounds]): Promise<InkBounds | null> {
  const load = async (url: string) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', {willReadFrequently: true})!
    context.drawImage(image, 0, 0)
    return {width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data}
  }
  return Promise.all([load(shownUrl), load(hiddenUrl)]).then(([shown, hidden]) => {
    const {width, height} = shown
    const rows = new Array<number>(height).fill(0)
    const columns = new Array<number>(width).fill(0)
    const differences: number[] = []
    for (let y = Math.max(0, Math.floor(within.top)); y < Math.min(height, Math.ceil(within.bottom)); y++)
      for (let x = Math.max(0, Math.floor(within.left)); x < Math.min(width, Math.ceil(within.right)); x++) {
        const at = (y * width + x) * 4
        let difference = 0
        for (let channel = 0; channel < 3; channel++)
          difference = Math.max(difference, Math.abs(shown.data[at + channel]! - hidden.data[at + channel]!))
        rows[y] = Math.max(rows[y]!, difference)
        columns[x] = Math.max(columns[x]!, difference)
        if (difference > 2) differences.push(difference)
      }
    if (!differences.length) return null
    // Full coverage: most of what is drawn covers its pixels whole (a fill, a glyph's stems at a device scale of 2), so a
    // high percentile of the differences, not their maximum, which a stray antialiased pixel can set.
    differences.sort((a, b) => a - b)
    const full = differences[Math.floor(differences.length * 0.75)]!
    const edges = (values: number[]): [number, number] => {
      // Differences under a tenth of full coverage are noise (a neighbor's antialiasing), not ink.
      const covered = values.map(value => (value < full / 10 ? 0 : Math.min(1, value / full)))
      const first = covered.findIndex(value => value > 0)
      let last = covered.length - 1
      while (last > first && !covered[last]) last--
      // An edge pixel's uncovered part lies outside the shape.
      return [first + 1 - covered[first]!, last + covered[last]!]
    }
    const [top, bottom] = edges(rows)
    const [left, right] = edges(columns)
    return {left, top, right, bottom}
  })
}
