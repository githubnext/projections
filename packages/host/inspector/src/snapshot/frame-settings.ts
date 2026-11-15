/**
 * How the image frames what it shows: `card` (the default), one rounded card with a hairline border holding the
 * stage, the legend and the summary bar divided by hairlines, on no background; `none`, the stage alone, edge to
 * edge; `page`, the Inspector's look: the stage edge to edge, then the legend and the summary bar as bands below it
 * (sweep thumbnails).
 */
export type SnapshotFrame = 'card' | 'none' | 'page'

export interface SnapshotFrameSettings {
  frame: SnapshotFrame
  /** A card frame's corners in this colour (`#rgb` or `#rrggbb`) instead of transparent. */
  matte?: string
}

/** Reads `frame` and `matte` from the snapshot page's query, rejecting anything unexpected. */
export function snapshotFrameSettings(query: URLSearchParams): SnapshotFrameSettings {
  const frame = query.get('frame') ?? 'card'
  if (frame !== 'card' && frame !== 'none' && frame !== 'page') throw new Error(`Unknown snapshot frame ${frame}`)
  const matte = query.get('matte') ?? undefined
  if (matte === undefined) return {frame}
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(matte)) throw new Error('The snapshot matte must be #rgb or #rrggbb')
  if (frame !== 'card') throw new Error('The snapshot matte fills the corners of the card frame')
  return {frame, matte}
}
