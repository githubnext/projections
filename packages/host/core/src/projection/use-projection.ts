import {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react'
import {projectionPhases} from './store.js'
import type {ProjectionController, ProjectionOptions} from './types.js'

/**
 * The headless Projections host. It owns the state that must be correct and
 * secure (renderer frames and their protocol, progress, selection, pane sync,
 * comparison modes and settings) and renders nothing itself: pass the
 * controller to `ProjectionStage` for the renderer frames, and build controls
 * with any design system from its state and actions. Every value can be
 * controlled (pass it with its `on…Change` handler) or left to the core
 * (optionally seeded with `initial…`). Without React, `createProjection` is
 * the same controller as a store.
 */
export function useProjection(options: ProjectionOptions): ProjectionController {
  const [phases] = useState(() => projectionPhases(options))
  useSyncExternalStore(phases.subscribe, phases.version, phases.version)
  const read = phases.read(options)
  // Started before paint, so playback's frames, and a state they change, render before paint too.
  useLayoutEffect(() => {
    phases.start()
    return () => phases.stop()
  }, [phases])
  // What was rendered is what the core keeps, and playback is reconciled with it before paint.
  useLayoutEffect(() => phases.commit(read))
  // The embedder hears of changes after paint.
  useEffect(() => phases.report())
  return read.controller
}
