import type {PlaybackFrame} from '@githubnext/projections-host'

/** How long the page must stay unchanged after every pane has painted, ms. */
export const quiet = 250

/**
 * Sets the marker `projections snapshot` waits for, with the failure's message, or the playback turn (see
 * `SnapshotSettings.turnFrameMs`) when it was asked for.
 */
export function markSnapshot(state: 'ready' | 'failed' | undefined, message?: string, turn?: readonly PlaybackFrame[]): void {
  const data = document.documentElement.dataset
  if (turn) data.projectionsSnapshotTurn = JSON.stringify(turn)
  else delete data.projectionsSnapshotTurn
  if (state) data.projectionsSnapshot = state
  else delete data.projectionsSnapshot
  if (message) data.projectionsSnapshotError = message
  else delete data.projectionsSnapshotError
}

export const frames = (count: number) =>
  new Promise<void>(resolve => {
    const next = (left: number) =>
      left
        ? requestAnimationFrame(() => {
            next(left - 1)
          })
        : resolve()
    next(count)
  })
