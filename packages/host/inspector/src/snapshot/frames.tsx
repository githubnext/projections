// How the snapshot page frames the stage, the legend and the summary bar (`SnapshotSettings.frame`).

import {useLayoutEffect, type CSSProperties, type ReactNode} from 'react'
import {ProjectionLegend, ProjectionStage, twoPaneMode, type ProjectionController} from '@githubnext/projections-host'
import {ScopedRoot} from '@githubnext/projections-host/ui/components'
import {SummaryBar} from '@githubnext/projections-host/ui'
import type {SnapshotSettings} from './settings.js'

export interface SnapshotFrameProps {
  projection: ProjectionController
  settings: SnapshotSettings
  comparing: boolean
  failure: string | undefined
  labels: {before: ReactNode; after: ReactNode} | undefined
}

/** A hairline in the theme's quiet rule colour: the card's edge and the rules between its sections. */
const hairline = '1px solid var(--projections-color-border)'

/**
 * The snapshot page in its frame: `card`, one rounded card with a hairline edge on no background (or the matte),
 * the stage on top, then the legend and the summary bar, each ruled off by a hairline and drawn flat inside it;
 * `none`, the stage alone, edge to edge; `page`, the Inspector's look: the stage edge to edge, then the legend and the
 * summary bar as bands below it. A hugging card (`hug`) with one frame gives its stage the height the renderer asks
 * for, at most the page's, so the card ends where the content's stage padding does.
 */
export function SnapshotFrame({projection, settings, comparing, failure, labels}: SnapshotFrameProps) {
  const {frame} = settings
  // The page's own background shows outside the card's corners: none, so they are transparent, or the matte.
  useLayoutEffect(() => {
    if (frame !== 'card') return
    const root = document.documentElement
    root.style.background = settings.matte ?? 'transparent'
    return () => {
      root.style.background = ''
    }
  }, [frame, settings.matte])
  const main: CSSProperties = {
    ...projection.themeStyle,
    boxSizing: 'border-box',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: 'var(--projections-color-fg)',
    fontFamily: 'var(--projections-font-family)',
  }
  const alert = failure && (
    <p role="alert" style={{margin: 0, padding: 12}}>
      {failure}
    </p>
  )
  const stage = (legend: boolean) => <ProjectionStage projection={projection} fill legend={legend} {...(labels ? {labels} : {})} />
  const mode = comparing ? projection.mode : 'extraction'

  if (frame === 'none') {
    return (
      <ScopedRoot colorMode={settings.theme} className="pi pi-snapshot">
        <main id="snapshot" data-mode={mode} data-frame="none" style={{...main, background: 'var(--projections-color-bg)'}}>
          {alert || <div style={{flex: 1, minHeight: 0}}>{stage(false)}</div>}
        </main>
      </ScopedRoot>
    )
  }

  if (frame === 'page') {
    return (
      <ScopedRoot colorMode={settings.theme} className="pi pi-snapshot">
        <main id="snapshot" data-mode={mode} data-frame="page" style={{...main, background: 'var(--projections-color-bg)'}}>
          {alert || (
            <>
              <div style={{flex: 1, minHeight: 0}}>{stage(true)}</div>
              {/* The summary bar, as every view has it: totals per kind, and a comparison's changes. */}
              <SummaryBar projection={projection} />
            </>
          )}
        </main>
      </ScopedRoot>
    )
  }

  // Two panes keep their own cards, set in from the card's edge.
  const inset = comparing && twoPaneMode(projection.mode) ? 12 : 0
  const hugged = settings.hug && !inset ? projection.panes.main.height : undefined
  const grow = hugged === undefined ? 1 : '0 1 auto'
  return (
    <ScopedRoot colorMode={settings.theme} className="pi pi-snapshot" style={{background: 'transparent'}}>
      {/* A pixel of room, so the card's anti-aliased edge is never cut by the image's. */}
      <main id="snapshot" data-mode={mode} data-frame="card" style={{...main, padding: 1}}>
        <div
          className="pi-snapshot-card"
          style={{
            flex: grow,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            border: hairline,
            borderRadius: 'var(--projections-radius-lg)',
            overflow: 'clip',
            background: 'var(--projections-color-surface-raised)',
          }}
        >
          {alert || (
            <>
              <div style={{flex: grow, minHeight: 0, padding: inset, ...(hugged === undefined ? {} : {height: hugged})}}>
                {stage(false)}
              </div>
              <ProjectionLegend
                projection={projection}
                style={{flexShrink: 0, padding: '8px 10px', borderTop: hairline, background: 'transparent'}}
              />
              <div style={{flexShrink: 0, borderTop: hairline, padding: '2px 4px'}}>
                <SummaryBar
                  projection={projection}
                  className="pj:h-6 pj:border-0 pj:bg-transparent pj:[--pj-summary-surface:var(--pj-surface-raised)] pj:px-0.5"
                />
              </div>
            </>
          )}
        </div>
      </main>
    </ScopedRoot>
  )
}
