// The pixel analysis of a rounded corner, which runs in the page: it must stay self-contained.

/** A point on one of a corner's straight sides, clear of its curve, and the inward normal there. */
export interface CornerSide {
  x: number
  y: number
  nx: number
  ny: number
}

/** One corner of a bordered box and its picture, in page CSS px. */
export interface CornerProbe {
  name: string
  url: string
  /** The picture's top-left corner. */
  origin: {x: number; y: number}
  /** The centre of the corner's outer arc. */
  centre: {x: number; y: number}
  /** Which way the corner points: -1 or 1 on each axis. */
  out: {x: number; y: number}
  radius: number
  width: number
  /** The vertical side, then the horizontal one. */
  sides: [CornerSide, CornerSide]
}

export interface CornerRay {
  /** Degrees from the vertical side (0) to the horizontal one (90). */
  angle: number
  /** The border's thickness across the curve there, in CSS px (null where it is too faint to measure). */
  thickness: number | null
  /** The largest difference from any blend of outside, border and inside: a third colour in the border. */
  foreign: number
  /** The largest difference from the outside past the outer curve: paint outside the corner. */
  outside: number
}

export interface CornerMeasure {
  name: string
  /** The border's thickness on the vertical and horizontal side (null where it is too faint to measure). */
  sides: [number | null, number | null]
  rays: CornerRay[]
}

/** Measures each corner's border across its curve and on its sides; runs in a page. */
export function measureCorners([probes, scale]: [CornerProbe[], number]): Promise<CornerMeasure[]> {
  type Rgb = [number, number, number]
  type Picture = {width: number; height: number; data: Uint8ClampedArray}
  const load = async (url: string): Promise<Picture> => {
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
  const sample = (picture: Picture, origin: {x: number; y: number}, x: number, y: number): Rgb => {
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
    ) as Rgb
  }
  const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  // How far a colour is along a segment (0 at its start, 1 at its end) and how far off it.
  const along = (p: Rgb, from: Rgb, to: Rgb) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as Rgb
    const length = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
    const projected = length ? ((p[0] - from[0]) * d[0] + (p[1] - from[1]) * d[1] + (p[2] - from[2]) * d[2]) / length : 0
    const t = Math.max(0, Math.min(1, projected))
    return {t, off: distance(p, [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t])}
  }
  // How much of a colour is border, between the outside and the inside, and how far it is from any such blend.
  const membership = (p: Rgb, outside: Rgb, border: Rgb, inside: Rgb) => {
    const outer = along(p, outside, border),
      inner = along(p, border, inside)
    return outer.off <= inner.off ? {weight: outer.t, off: outer.off} : {weight: 1 - inner.t, off: inner.off}
  }
  // Too little contrast between the border and either neighbour to tell how much of a pixel it covers.
  const faint = 40
  const step = 0.25 / scale
  return Promise.all(probes.map(async probe => ({probe, picture: await load(probe.url)}))).then(loaded =>
    loaded.map(({probe, picture}) => {
      const at = (x: number, y: number) => sample(picture, probe.origin, x, y)
      const {radius, width} = probe
      // Each side's painted edge (a browser may snap a box's edges to whole pixels), outside (just past its antialiasing:
      // a neighbour may be a pixel or two away), border and thickness.
      const sides = probe.sides.map(side => {
        const point = (t: number) => at(side.x + side.nx * t, side.y + side.ny * t)
        const far = point(-1.75)
        let border = far
        for (let t = -1; t <= width + 1; t += step) if (distance(point(t), far) > distance(border, far)) border = point(t)
        const contrast = distance(border, far)
        let edge = 0
        for (let t = -1.75; t <= width + 1; t += step)
          if (distance(point(t), far) >= contrast / 2) {
            edge = t
            break
          }
        const outside = point(edge - 0.75),
          inside = point(edge + width + 1.5)
        border = point(edge + width / 2)
        if (contrast < faint || distance(border, outside) < faint || distance(border, inside) < faint)
          return {edge, outside, border, thickness: null}
        let thickness = 0
        for (let t = edge - 1; t <= edge + width + 1.5; t += step) thickness += membership(point(t), outside, border, inside).weight * step
        return {edge, outside, border, thickness}
      })
      // The arc's centre, moved with its sides' painted edges.
      const centre = {x: probe.centre.x + probe.sides[0].nx * sides[0]!.edge, y: probe.centre.y + probe.sides[1].ny * sides[1]!.edge}
      const rays = [10, 25, 45, 65, 80].map(angle => {
        const radians = (angle * Math.PI) / 180
        const dx = probe.out.x * Math.cos(radians),
          dy = probe.out.y * Math.sin(radians)
        const point = (t: number) => at(centre.x + dx * t, centre.y + dy * t)
        const start = Math.max(0, radius - width - 1.5)
        // Past the outer curve, but inside the box's square corner: what is there is the box's own paint.
        const end = Math.max(radius + 0.5, Math.min(radius + 4, radius * Math.SQRT2 - 0.5))
        const inside = point(start)
        const nearest = angle < 45 ? [sides[0]!] : angle > 45 ? [sides[1]!] : sides
        const measures = nearest.map(side => {
          let thickness = 0,
            foreign = 0,
            outside = 0
          for (let t = start; t <= end; t += step) {
            const p = point(t)
            const {weight, off} = membership(p, side.outside, side.border, inside)
            thickness += weight * step
            if (t <= radius) foreign = Math.max(foreign, off)
            else if (t > radius + 1 / scale) outside = Math.max(outside, Math.min(...sides.map(other => distance(p, other.outside))))
          }
          const measurable = side.thickness !== null && distance(side.border, inside) >= faint
          return {angle, thickness: measurable ? thickness : null, foreign, outside}
        })
        return measures.reduce((best, next) => (next.foreign < best.foreign ? next : best))
      })
      return {name: probe.name, sides: [sides[0]!.thickness, sides[1]!.thickness] as [number | null, number | null], rays}
    }),
  )
}
