import {useEffect, useRef, useState} from 'react'
import {ScopedRoot} from '@githubnext/projections-host/ui/components'
import type {StageApi, StageState} from '@githubnext/projections-renderer-testing'
import {stageApi} from './session.js'
import type {FixturesContext, FixturesStore} from './session.js'
import {Stage} from './stage.js'

declare global {
  interface Window {
    projectionsStage: StageApi
  }
}

/**
 * `?view=stage`: one renderer frame and nothing else, driven from tests
 * through `window.projectionsStage` (see `@githubnext/projections-renderer-testing/playwright`).
 */
export function StagePage({store, context}: {store: FixturesStore; context: FixturesContext}) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<StageState | undefined>()
  useEffect(() => {
    const stage = new Stage(container.current!, setState)
    window.projectionsStage = stageApi(stage, store, context)
    document.documentElement.dataset.projectionsStage = 'ready'
    return () => {
      stage.dispose()
      delete document.documentElement.dataset.projectionsStage
    }
  }, [store, context])
  const status =
    !state || state.status === 'waiting'
      ? 'Waiting for a test to load a renderer…'
      : state.status === 'failed'
        ? `Renderer failed: ${state.failure}`
        : state.status === 'loading'
          ? 'Loading…'
          : `${state.bundle} renderer at ${state.progress}`
  return (
    <ScopedRoot colorMode={state && container.current?.dataset.colorMode === 'dark' ? 'dark' : 'light'} className="pi pi-stage">
      <main
        id="stage"
        className="pj:flex pj:min-h-screen pj:flex-col pj:bg-background pj:text-foreground"
        data-status={state?.status ?? 'waiting'}
        data-progress={state?.progress}
        data-rendered-progress={state?.rendered ?? ''}
        data-selection={state?.selection ?? ''}
      >
        <p id="stage-status" role="status" className="pj:sr-only">
          {status}
        </p>
        <div id="stage-frame" ref={container} className="pj:max-w-full" />
      </main>
    </ScopedRoot>
  )
}
