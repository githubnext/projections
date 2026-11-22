import type {ExtractionDocument} from '@githubnext/projections-schemas'
import {paintState, type PaneKey, type useProjection} from '@githubnext/projections-host'
import type {SnapshotSettings} from './settings.js'

type Projection = ReturnType<typeof useProjection>
type Pane = Projection['panes'][PaneKey]

/** What decides whether the snapshot's frames show what was asked. */
export interface SnapshotState {
  projection: Projection
  settings: SnapshotSettings
  comparing: boolean
  requested: ExtractionDocument['projection']['renderer']
  /** Whether the custom renderer is served (or withheld) for this snapshot. */
  custom: boolean
  notice: string | undefined
  /** The shown panes' states. */
  panes: Pane[]
}

/** Why no renderer presents the snapshot, if none does. */
function rendererFailure({projection, settings, requested, custom, notice}: SnapshotState): string | undefined {
  if (typeof requested !== 'string' && !settings.withheld && !custom) {
    return `The custom renderer ${requested.bundle} is not served for this snapshot`
  }
  if (!projection.renderer) {
    return typeof requested === 'string'
      ? `The renderer "${requested}" is not available in this build of Projections`
      : (notice ?? 'No renderer can present this projection')
  }
  return undefined
}

/** A renderer that stopped or reported a problem in a pane. */
function paneFailure(title: string, panes: Pane[]): string | undefined {
  const stopped = panes.find(pane => pane.status === 'failed')
  if (stopped) return `The ${title} renderer stopped: ${stopped.message ?? 'unknown failure'}`
  const reported = panes.find(pane => pane.rendererErrors.length)
  if (reported) return `The ${title} renderer reported a problem: ${reported.rendererErrors.at(-1)}`
  return undefined
}

/** A requested mode or progress the renderer doesn't have. */
function modeFailure(title: string, {projection, settings}: SnapshotState): string | undefined {
  if (settings.mode && !projection.availableModes.includes(settings.mode)) {
    return `The ${title} renderer has no ${settings.mode} mode; it offers ${projection.availableModes.join(', ')}`
  }
  if (settings.progress !== undefined && !projection.availableModes.includes('animated')) {
    return `--progress applies to animated comparisons; the ${title} renderer offers ${projection.availableModes.join(', ')} (use --mode)`
  }
  return undefined
}

/** Whether the snapshot failed (and why), is still waiting for its panes, or has painted what was asked. */
export function snapshotReadiness(state: SnapshotState): {failure: string} | 'waiting' | 'painted' {
  const {projection, comparing, panes} = state
  const unrendered = rendererFailure(state)
  if (unrendered) return {failure: unrendered}
  const title = projection.renderer!.title
  const failure = paneFailure(title, panes)
  if (failure) return {failure}
  if (panes.some(pane => pane.status !== 'ready' || !pane.capabilities)) return 'waiting'
  const unavailable = comparing ? modeFailure(title, state) : undefined
  if (unavailable) return {failure: unavailable}
  // The renderer's capabilities may still move the stage to its own default mode.
  if (comparing && !projection.availableModes.includes(projection.mode)) return 'waiting'
  // Every shown pane has painted what it was asked, for the document it has now (`paintState`). Animated waits for the
  // exact progress requested, not the controller's, which a step can snap to its end.
  return paintState({...projection, progress: state.settings.progress ?? 1}) === 'painted' ? 'painted' : 'waiting'
}
