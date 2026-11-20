import {useState} from 'react'
import type {ProjectionController} from './projection/types.js'
import {offeredViews, recoveryView, shownView} from './view-model.js'
import type {ProjectionFeatures, ViewKind} from './view-model.js'

/** The views a host offers, the one it shows, and how to choose another (`useViewChoice`). */
export interface ViewChoice {
  /** The views offered (`offeredViews`). */
  views: ViewKind[]
  /** The view shown: the chosen one while it is offered, else the first. */
  view: ViewKind
  setView: (view: ViewKind) => void
  /** The built-in view to offer when the renderer fails (`recoveryView`). */
  recoverView: 'table' | 'text' | undefined
}

/**
 * Which view a host shows: `initialView` when it is offered, else the first offered (the renderer's, when there is
 * one), then whatever the person chooses. When a renderer arrives where there was none (a comparison's renderer
 * resolves, or one is chosen), its view is shown.
 */
export function useViewChoice(
  projection: Pick<ProjectionController, 'renderer'>,
  features?: ProjectionFeatures,
  initialView?: ViewKind,
): ViewChoice {
  const {renderer} = projection
  const views = offeredViews(projection, features)
  const [chosen, setView] = useState<ViewKind>(() => shownView(views, initialView))
  const [shownRenderer, setShownRenderer] = useState(renderer)
  if (shownRenderer !== renderer) {
    setShownRenderer(renderer)
    if (renderer && !shownRenderer) setView('renderer')
  }
  return {views, view: shownView(views, chosen), setView, recoverView: recoveryView(views)}
}
