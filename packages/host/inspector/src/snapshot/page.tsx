// `?view=snapshot`, the chrome-free page `projections snapshot` captures: its settings, the document, the marker,
// readiness, the frame and the page (here).

import {useEffect, useMemo, useState} from 'react'
import {
  builtinRendererDocuments,
  compatibleRenderers,
  customRenderer,
  endpointHoldMs,
  playbackTurn,
  resolveRenderer,
  stepHoldMs,
  twoPaneMode,
  useProjection,
} from '@githubnext/projections-host'
import type {PaneKey, RendererEntry, RendererManifest, ViewSubject, WithheldRenderer} from '@githubnext/projections-host'
import {revisionLabel} from '../app/revisions.js'
import type {SnapshotDocument} from './document.js'
import {SnapshotFrame} from './frames.js'
import {frames, markSnapshot, quiet} from './marker.js'
import {snapshotReadiness} from './readiness.js'
import type {SnapshotSettings} from './settings.js'

const customManifest: RendererManifest = {format: 'projections.renderer', version: 0, name: 'custom', title: 'Custom', handles: []}

export interface SnapshotPageProps {
  document: SnapshotDocument
  settings: SnapshotSettings
  /** Built-in renderer bundles. */
  renderers: readonly RendererEntry[]
  /** Same-origin prefix of custom renderer bundles, `<prefix><revision>/<projection>/index.html`. */
  customRendererBase?: string | undefined
}

export function SnapshotPage({document: snapshot, settings, renderers, customRendererBase}: SnapshotPageProps) {
  const comparing = snapshot.format === 'projections.comparison'
  const shown = comparing ? snapshot.after : snapshot
  const requested = shown.projection.renderer
  const subject = useMemo<ViewSubject>(
    () =>
      snapshot.format === 'projections.comparison'
        ? {mode: 'comparison', before: snapshot.before.extraction, after: snapshot.after.extraction, comparison: snapshot.comparison}
        : {mode: 'extraction', extraction: snapshot.extraction},
    [snapshot],
  )
  const custom = useMemo((): RendererEntry | WithheldRenderer | undefined => {
    if (typeof requested === 'string') return undefined
    if (settings.withheld) {
      return {
        withheld: `The custom renderer ${requested.bundle} is repository code that differs from the default branch's, so it needs --trust.`,
      }
    }
    if (!customRendererBase || !settings.definition) return undefined
    return customRenderer(
      {...customManifest, title: shown.projection.title || customManifest.title},
      `${customRendererBase}${encodeURIComponent(settings.definition)}/${encodeURIComponent(shown.projection.id)}/index.html`,
    )
  }, [requested, settings.withheld, settings.definition, customRendererBase, shown.projection.id, shown.projection.title])
  const resolution = useMemo(
    () => resolveRenderer(requested, renderers, custom, shown.extraction),
    [requested, renderers, custom, shown.extraction],
  )
  const rendererDocuments = useMemo(() => builtinRendererDocuments(renderers), [renderers])
  const available = useMemo(() => compatibleRenderers(shown, renderers, resolution.renderer), [shown, renderers, resolution.renderer])
  const presentation = shown.provenance.definition.presentation
  const projection = useProjection({
    subject,
    projection: {
      id: shown.projection.id,
      title: shown.projection.title,
      renderer: typeof requested === 'string' ? requested : requested.bundle,
    },
    renderers: resolution.renderer ? available : [],
    rendererDocuments,
    rendererNotice: resolution.notice,
    presentation,
    ...(settings.focus ? {focus: settings.focus} : {}),
    colorMode: settings.theme,
    // Without a mode, the renderer's own default (diff when it has one), as the Inspector opens; a progress means animated.
    ...(settings.mode ? {initialMode: settings.mode} : settings.progress !== undefined ? {initialMode: 'animated' as const} : {}),
    progress: settings.progress ?? 1,
    ...(settings.direction ? {direction: settings.direction} : {}),
    playing: false,
    loop: false,
  })
  const [failure, setFailure] = useState<string | undefined>()
  const renderer = projection.renderer
  const keys: PaneKey[] = twoPaneMode(projection.mode) && comparing ? ['before', 'after'] : ['main']
  const panes = keys.map(key => projection.panes[key])
  // Everything that decides whether the frames show what was asked.
  const signature = JSON.stringify([
    projection.mode,
    projection.availableModes,
    panes.map(pane => [pane.status, pane.rendered, Boolean(pane.capabilities), pane.rendererErrors.at(-1) ?? '', pane.message ?? '']),
    // A hugging card takes the height the renderer asks for, so a new one lays the page out again.
    settings.hug ? panes.map(pane => pane.height ?? null) : null,
    // A legend the renderer sends after it first paints changes the page too.
    projection.legend ?? null,
    // So does the summary the renderer words the bar with.
    projection.summary,
    // And the step ends and pace that time playback.
    projection.stepEnds,
    projection.baseDurationMs,
  ])
  useEffect(() => {
    if (failure) {
      markSnapshot('failed', failure)
      return
    }
    const readiness = snapshotReadiness({
      projection,
      settings,
      comparing,
      requested,
      custom: Boolean(custom),
      notice: resolution.notice,
      panes,
    })
    if (typeof readiness === 'object') {
      setFailure(readiness.failure)
      return
    }
    if (readiness === 'waiting') return
    let cancelled = false
    // A quiet moment first: anything the renderer still sends (such as its legend) changes `signature` and starts over.
    void document.fonts.ready
      .then(() => new Promise(resolve => setTimeout(resolve, quiet)))
      .then(() => frames(2))
      .then(() => {
        if (cancelled) return
        const {turnFrameMs, direction = 1} = settings
        const turn =
          turnFrameMs === undefined
            ? undefined
            : playbackTurn(
                {stops: projection.stepEnds, travelMs: projection.baseDurationMs, stepHoldMs, endpointHoldMs},
                direction,
                turnFrameMs,
              )
        markSnapshot('ready', undefined, turn)
      })
    return () => {
      cancelled = true
      markSnapshot(undefined)
    }
    // `signature` covers the pane and mode state read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signature,
    failure,
    renderer,
    requested,
    custom,
    resolution.notice,
    comparing,
    settings.mode,
    settings.progress,
    settings.direction,
    settings.turnFrameMs,
    settings.withheld,
  ])

  const labels = comparing
    ? {before: `Before · ${revisionLabel(snapshot.before)}`, after: `After · ${revisionLabel(snapshot.after)}`}
    : undefined
  return <SnapshotFrame projection={projection} settings={settings} comparing={comparing} failure={failure} labels={labels} />
}
