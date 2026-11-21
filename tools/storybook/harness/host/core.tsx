// A host built only on the headless core: its own minimal controls, side by side only, no playback (packages/host/core/browser/core.spec.ts).
import {useEffect, useState} from 'react'
import type {ProjectionEngine} from '@githubnext/projections-schemas'
import {createWasmEngine} from '@githubnext/projections-engine/browser'
import engineWasm from '@githubnext/projections-engine/engine.wasm?url'
import defaultComparatorWasm from '@githubnext/projections-engine/default-comparator.wasm?url'
import {LoadingStatus, ProjectionStage, loadRendererCatalog, resolveRenderer, useProjection} from '@githubnext/projections-host'
import type {RendererEntry, ViewSubject} from '@githubnext/projections-host'
import {demonstration, laterRevision} from './fixtures.js'

const params = new URLSearchParams(location.search)
// `?fill` puts the stage in a fixed-height container it fills; `?mode=animated|swipe` picks another mode;
// `?paneLabels=chips|hidden` labels the panes another way; `?utility` floats a stand-in bar in the stage's utility area.
const fill = params.has('fill')
const utility = params.has('utility') ? <span aria-label="Utility content" style={{display: 'block', width: 320, height: 40}} /> : undefined
const paneLabels =
  params.get('paneLabels') === 'chips' || params.get('paneLabels') === 'hidden'
    ? (params.get('paneLabels') as 'chips' | 'hidden')
    : 'visible'
const mode =
  params.get('mode') === 'animated' || params.get('mode') === 'swipe' ? (params.get('mode') as 'animated' | 'swipe') : 'side-by-side'

function Review({subject, renderer}: {subject: ViewSubject; renderer: RendererEntry | undefined}) {
  // This host opts in to the connector, which is off by default.
  const projection = useProjection({
    subject,
    projection: {id: 'checkout', title: 'Checkout evolution'},
    renderers: renderer ? [renderer] : [],
    mode,
    highlighting: 'on',
    connector: true,
    // Every item, so the custom find field narrows all of them.
    initialChangesOnly: false,
  })
  return (
    <main style={{fontFamily: 'system-ui', maxWidth: 1100, margin: '24px auto', padding: '0 16px'}}>
      <h1 style={{fontSize: 20}}>Custom host: side by side only</h1>
      <p>
        <label>
          Find <input aria-label="Find" value={projection.search} onChange={event => projection.setSearch(event.target.value)} />
        </label>{' '}
        <button type="button" onClick={() => projection.select(null)}>
          Clear selection
        </button>{' '}
        <span>
          Selected: <output aria-label="Custom selection">{projection.selectedRow?.label ?? 'nothing'}</output>
        </span>{' '}
        <span>
          Status: <output aria-label="Custom status">{projection.rendererStatus}</output>
        </span>
      </p>
      {fill ? (
        <div className="core-fill" style={{height: 520, border: '1px solid #d1d9e0'}}>
          <ProjectionStage
            projection={projection}
            labels={{before: 'Base', after: 'Head'}}
            paneLabels={paneLabels}
            utility={utility}
            fill
          />
        </div>
      ) : (
        <ProjectionStage projection={projection} labels={{before: 'Base', after: 'Head'}} paneLabels={paneLabels} utility={utility} />
      )}
    </main>
  )
}

export function CoreHarness() {
  const [state, setState] = useState<{engine: ProjectionEngine; renderers: RendererEntry[]}>()
  const [subject, setSubject] = useState<ViewSubject>()
  useEffect(() => {
    void Promise.all([
      createWasmEngine({url: new URL(engineWasm, location.href)}, {url: new URL(defaultComparatorWasm, location.href)}),
      loadRendererCatalog({base: new URL('./renderers/', location.href)}),
    ]).then(async ([engine, renderers]) => {
      const data = demonstration('graph/v0')
      const after = laterRevision(data.after)
      setSubject({mode: 'comparison', before: data.before, after, comparison: await engine.compare(data.before, after)})
      setState({engine, renderers})
    })
  }, [])
  if (!state || !subject) {
    return (
      <div style={{display: 'flex', height: '100dvh', fontFamily: 'system-ui'}}>
        <LoadingStatus label="Starting the engine…" />
      </div>
    )
  }
  return <Review subject={subject} renderer={resolveRenderer('graph', state.renderers).renderer} />
}
