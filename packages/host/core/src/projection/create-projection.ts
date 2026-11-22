// `createProjection`: the projection's phases run after every change, for a host without React.
import {projectionPhases} from './store.js'
import type {ProjectionController, ProjectionOptions} from './types.js'

/** A projection without a framework: read its controller, hear when it changes, and give it new options. */
export interface ProjectionStore {
  /** The controller as it stands: the same object until something changes. */
  getSnapshot(): ProjectionController
  /** Calls `listener` after each change; returns the function that stops it. */
  subscribe(listener: () => void): () => void
  /** The embedder's new options: controlled values, handlers, the subject. */
  update(options: ProjectionOptions): void
  /**
   * Starts it: playback's frames, watching the person's preferences, and telling the embedder what changes. Call it
   * before acting on the controller. Construction starts nothing.
   */
  start(): void
  /** Stops what `start` started; the state is kept, and `start` resumes it. */
  stop(): void
}

/** Reports an error without throwing: `reportError` where there is one, else the console. */
function reportError(error: Error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
  else console.error(error)
}

/** How many reads one change may lead to (a report that changes the state is read again) before it is reported as not settling. */
const settleRounds = 50

/**
 * The headless Projections host without a framework: `useProjection`'s controller, its state and actions, as a store.
 * Every change is read, committed and reported before listeners hear of it, so `getSnapshot` is always settled.
 */
export function createProjection(options: ProjectionOptions): ProjectionStore {
  const phases = projectionPhases(options)
  let latest = options
  let snapshot = phases.read(options).controller
  const listeners = new Set<() => void>()
  let detach: (() => void) | undefined
  // A change while one is being settled is settled in the same pass.
  let settling: {again: boolean} | undefined
  const settle = () => {
    if (settling) {
      settling.again = true
      return
    }
    settling = {again: true}
    try {
      for (let round = 0; round < settleRounds && settling.again; round++) {
        settling.again = false
        const read = phases.read(latest)
        phases.commit(read)
        // Published before the embedder is told, so a handler that reads the snapshot sees what it is told of.
        snapshot = read.controller
        phases.report()
      }
      if (settling.again) {
        // Still changing: the snapshot shows the state as it is, and the loop is reported rather than hidden.
        snapshot = phases.read(latest).controller
        reportError(new Error(`The projection didn't settle in ${settleRounds} rounds: an on…Change handler keeps changing it.`))
      }
    } finally {
      settling = undefined
    }
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next) {
      latest = next
      if (detach) settle()
      else snapshot = phases.read(next).controller
    },
    start() {
      if (detach) return
      detach = phases.subscribe(settle)
      phases.start()
      // A listener may have stopped it while it started.
      if (phases.running) settle()
    },
    stop() {
      detach?.()
      detach = undefined
      phases.stop()
    },
  }
}
