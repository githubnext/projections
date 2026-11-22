// The pixel analysis of a ring, which runs in the page: it must stay self-contained.

export interface Line {
  name: string
  x: number
  y: number
  dx: number
  dy: number
  length: number
  /** A side's line where a corner's curve has begun (a circle's sides away from their middle): the item's edge there is inside its box. */
  curved?: boolean
}

/** Compares neutral and ringed pictures of the same region along the lines; runs in a page. */
export function analyze([neutralUrl, ringedUrl, origin, scale, lines, mode]: [
  string,
  string,
  {x: number; y: number},
  number,
  Line[],
  string,
]) {
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
  return Promise.all([load(neutralUrl), load(ringedUrl)]).then(([neutral, ringed]) => {
    const sample = (picture: typeof neutral, x: number, y: number): [number, number, number] => {
      // Bilinear, in device pixels, at pixel centres.
      const fx = (x - origin.x) * scale - 0.5,
        fy = (y - origin.y) * scale - 0.5
      const x0 = Math.max(0, Math.min(picture.width - 1, Math.floor(fx))),
        y0 = Math.max(0, Math.min(picture.height - 1, Math.floor(fy)))
      const x1 = Math.min(picture.width - 1, x0 + 1),
        y1 = Math.min(picture.height - 1, y0 + 1)
      const tx = Math.max(0, Math.min(1, fx - x0)),
        ty = Math.max(0, Math.min(1, fy - y0))
      const at = (px: number, py: number, channel: number) => picture.data[(py * picture.width + px) * 4 + channel]!
      return [0, 1, 2].map(
        channel =>
          at(x0, y0, channel) * (1 - tx) * (1 - ty) +
          at(x1, y0, channel) * tx * (1 - ty) +
          at(x0, y1, channel) * (1 - tx) * ty +
          at(x1, y1, channel) * tx * ty,
      ) as [number, number, number]
    }
    const distance = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!)
    const step = 0.25 / scale
    const results = lines.map(line => {
      const ts: number[] = []
      for (let t = 0; t <= line.length; t += step) ts.push(t)
      const at = (picture: typeof neutral, t: number) => sample(picture, line.x + line.dx * t, line.y + line.dy * t)
      const n = ts.map(t => at(neutral, t)),
        r = ts.map(t => at(ringed, t))
      const crossing = (values: number[], threshold: number, from = 0) => {
        for (let index = Math.max(1, from); index < values.length; index++) {
          if (values[index - 1]! < threshold && values[index]! >= threshold) {
            const fraction = (threshold - values[index - 1]!) / (values[index]! - values[index - 1]! || 1)
            return {t: ts[index - 1]! + fraction * step, index}
          }
        }
        return values[0]! >= threshold && from === 0 ? {t: 0, index: 0} : null
      }
      const change = n.map((color, index) => distance(color, r[index]!))
      const strongest = Math.max(...change)
      let ring: number | null = null,
        ringEnd: number | null = null
      // Half the strongest change, or less: a ring over a dark edge changes it less than over a light inside.
      const threshold = Math.min(strongest / 2, 100)
      if (strongest > 90) {
        const start = crossing(change, threshold)
        if (start) {
          ring = start.t
          ringEnd = line.length
          for (let index = start.index + 1; index < change.length; index++) {
            if (change[index]! < threshold) {
              const fraction = (change[index - 1]! - threshold) / (change[index - 1]! - change[index]! || 1)
              ringEnd = ts[index - 1]! + fraction * step
              break
            }
          }
        }
      }
      // The item's edge: where the neutral picture leaves the outside color, at half its first peak.
      // Only near the ring: lines and shapes further out (a neighbor, a relationship) aren't the item's edge.
      const from = ring === null ? 0 : Math.max(0, Math.floor((ring - 3) / step))
      const outsideHere = n[from]!
      const departure = n.map((color, index) => (index < from ? 0 : distance(color, outsideHere)))
      const first = departure.findIndex(value => value > 30)
      let edge: number | null = null,
        edgeEnd: number | null = null,
        color: [number, number, number] | null = null
      if (first >= 0) {
        const window = departure.slice(first, first + Math.ceil(3 / step))
        const peak = Math.max(...window)
        const start = crossing(departure, Math.min(peak / 2, 100))
        if (start) {
          edge = start.t
          // The edge band: the run from the edge that keeps the edge's color. A run longer than 6 px is a fill, not a line.
          const edgeColor = n[departure.indexOf(peak, first)]!
          color = edgeColor
          const reach = distance(edgeColor, outsideHere)
          for (let index = start.index; index < n.length; index++) {
            if (ts[index]! - edge > 6) break
            if (distance(n[index]!, edgeColor) > reach * 0.5) {
              edgeEnd = ts[index]!
              break
            }
          }
        }
      }
      // Plain surroundings: outside the item, up to near the ring, the picture is one color. Where content crosses the
      // item's edge (a neighbor's label on its halo), the line can't tell the edge from the content.
      const clean = n.slice(0, from).every(color => distance(color, n[0]!) < 30)
      // Each line starts 8 px outside the item's box (see `ringLines`); its own edge (a centred border up to 2 px wide)
      // starts at most a pixel outside it.
      const box = 8,
        spill = 1
      // Whether the item's edge shows where its geometry puts it, with nothing else drawn just outside it.
      const before = Math.max(0, Math.floor((box - spill - 1) / step))
      const hidden =
        edge === null || edge < box - spill - 1 || edge > box + 1 || !n.slice(0, before).every(other => distance(other, n[0]!) < 30)
      // What departs further out is a neighbor (another item's outline or label), and past a pixel inside the item's box
      // it is its inside: neither is its edge.
      if (edge !== null && (edge < box - spill - 1 || edge > box + 1)) edge = edgeEnd = color = null
      return {line: line.name, hidden, edge, edgeEnd, edgeColor: color, ring, ringEnd, clean}
    })
    if (mode === 'halo') return results
    return results
  })
}
