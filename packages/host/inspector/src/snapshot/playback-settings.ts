/** Where in playback the snapshot is, beyond its progress: what `--frames` asks of the page. */
export interface SnapshotPlaybackSettings {
  /** The playback direction the renderer draws the progress for; omitted, forward. */
  direction?: 1 | -1
  /**
   * Also publish one turn of looping playback in `direction`, sampled every `turnFrameMs` (see `playbackTurn`), as
   * `<html data-projections-snapshot-turn>`: what `--frames` draws.
   */
  turnFrameMs?: number
}

/** Reads `direction` and `turn` from the snapshot page's query, rejecting anything unexpected. */
export function snapshotPlaybackSettings(query: URLSearchParams): SnapshotPlaybackSettings {
  const direction = query.get('direction') ?? undefined
  if (direction !== undefined && direction !== 'forward' && direction !== 'backward') {
    throw new Error(`Unknown snapshot direction ${direction}`)
  }
  const turn = query.get('turn')
  const turnFrameMs = turn === null ? undefined : Number(turn)
  if (turnFrameMs !== undefined && (turn === '' || !Number.isFinite(turnFrameMs) || turnFrameMs < 1 || turnFrameMs > 1000)) {
    throw new Error('The snapshot turn frame must be 1 to 1000 ms')
  }
  return {
    ...(direction ? {direction: direction === 'backward' ? (-1 as const) : (1 as const)} : {}),
    ...(turnFrameMs === undefined ? {} : {turnFrameMs}),
  }
}
