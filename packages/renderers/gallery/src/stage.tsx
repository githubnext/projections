// One scenario drawn by its own renderer, in a sandboxed frame nested in the gallery's.
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {usePaintGate} from '@githubnext/projections-renderer-kit/react'
import {embedRenderer, type EmbeddedRenderer} from '@githubnext/projections-renderer-sdk/client'
import type {RendererCapabilities, RendererEnvironment} from '@githubnext/projections-renderer-sdk/protocol'
import {nestedPresentation, restingProgress, scenarioOf, type Scenario} from './model.js'

/**
 * A gallery with at most this many scenarios runs every one's renderer, as does one in a content-sized frame; a larger
 * one in a frame that scrolls runs only those near the view.
 */
export const eagerScenarios = 12

/** How many nested renderers load at once; the rest wait their turn. */
export const concurrentLoads = 4

/** A queue of load slots: `acquire` resolves with a function that frees the slot, which may be called more than once. */
export function loadQueue(limit: number) {
  let running = 0
  const waiting: (() => void)[] = []
  return {
    acquire(): Promise<() => void> {
      return new Promise(resolve => {
        const start = () => {
          running++
          let freed = false
          resolve(() => {
            if (freed) return
            freed = true
            running--
            waiting.shift()?.()
          })
        }
        if (running < limit) start()
        else waiting.push(start)
      })
    },
  }
}
const loads = loadQueue(concurrentLoads)

/** How long a nested renderer has, once ready, to draw its scenario before its card fails, in milliseconds. */
export const paintTimeoutMs = 10_000

/** How long hovering an animated comparison plays it from before to after, in milliseconds. */
export const playMs = 2400

/** Where a stage is: waiting to scroll near, loading its renderer, drawn, or why it can't be. */
type StageState = ({status: 'idle' | 'loading' | 'ready'} | {status: 'failed'; message: string}) & {
  /** The scenario entity it is the state of: a frame for an earlier one is never taken as drawn. */
  entity?: Entity
}

/** Whether the element intersects the view, grown by `margin`; undefined until first known. */
function useInView(element: React.RefObject<HTMLElement | null>, margin: string, always: boolean): boolean | undefined {
  const [inView, setInView] = useState<boolean | undefined>(always || undefined)
  // Without an observer to ask, everything is in view.
  const observed = !always && typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const target = element.current
    if (!observed || !target) return undefined
    const observer = new IntersectionObserver(entries => setInView(entries.some(entry => entry.isIntersecting)), {rootMargin: margin})
    observer.observe(target)
    return () => observer.disconnect()
  }, [element, margin, observed])
  return observed ? inView : true
}

/**
 * The scenario's renderer, nested: the gallery's host supplies the built-in renderer's document by name, and
 * `embedRenderer` runs and hosts it. Selecting inside it selects the scenario. An animated comparison rests on its after
 * revision with its changes emphasized, and plays from before to after while the pointer or focus is on it.
 */
export function NestedStage({
  entity,
  environment,
  requestDocument,
  playing,
  eager,
  drawable = true,
  onSelect,
}: {
  /** The scenario entity at the revision shown: a new one (another revision) loads the frame again. */
  entity: Entity
  environment: RendererEnvironment
  requestDocument: (name: string) => Promise<string>
  /** Whether to play an animated comparison now. */
  playing: boolean
  /** Whether to run its renderer wherever it is, as a small gallery does (`eagerScenarios`). */
  eager: boolean
  /** False for a scenario a content-sized frame names but doesn't draw (`contentDrawn`). */
  drawable?: boolean
  onSelect: () => void
}) {
  const title = entity.label
  const scenario = useMemo(() => scenarioOf(entity), [entity])
  const custom = scenario.bundle !== undefined
  const host = useRef<HTMLDivElement>(null)
  // In a long gallery a renderer runs only near the view, so it keeps a few frames alive rather than every one. Each holds
  // the gallery's paint acknowledgement until it has painted, so the host never shows or captures one half drawn.
  const inView = useInView(host, '800px 0px', eager)
  const near = drawable ? inView : false
  const nested = useRef<EmbeddedRenderer | null>(null)
  const [state, setState] = useState<StageState>({status: 'idle'})
  const animated = useRef(false)
  const label = `${title}, drawn by the ${scenario.renderer} renderer`
  const latest = useRef({environment, onSelect, scenario, title, label})
  useLayoutEffect(() => {
    latest.current = {environment, onSelect, scenario, title, label}
  })

  // One frame per scenario document: a new subject loads it again.
  useEffect(() => {
    const container = host.current
    if (!near || !container || !scenario.subject || scenario.bundle !== undefined) return undefined
    setState({status: 'loading', entity})
    const stop = loadNested(container, scenario, requestDocument, {
      present: declared =>
        nestedPresentation(entity.id, latest.current.title, latest.current.scenario, latest.current.environment, declared)!,
      label: () => latest.current.label,
      colorMode: () => latest.current.environment.theme.colorMode,
      started: frame => {
        nested.current = frame
      },
      animated: value => {
        animated.current = value
      },
      select: () => latest.current.onSelect(),
      settled: next => setState({...next, entity}),
    })
    return () => {
      stop()
      nested.current = null
      setState({status: 'idle'})
    }
    // The label and environment reach a running frame without reloading it.
  }, [near, entity, scenario, requestDocument])

  useEffect(() => {
    nested.current?.setEnvironment({...withoutPane(environment), sizing: 'fill'})
  }, [environment])
  useEffect(() => {
    nested.current?.iframe.setAttribute('aria-label', label)
  }, [label])

  // Hovering or focusing an animated comparison plays it once from before to after, then it rests again.
  useEffect(() => {
    const frame = nested.current
    if (!frame || !playing || !animated.current || state.status !== 'ready' || environment.reducedMotion) return undefined
    const view = host.current?.ownerDocument.defaultView ?? globalThis.window
    const start = view.performance.now()
    let handle = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / playMs)
      frame.setProgress({progress, highlighting: 1, direction: 1})
      if (progress < 1) handle = view.requestAnimationFrame(tick)
    }
    handle = view.requestAnimationFrame(tick)
    return () => {
      view.cancelAnimationFrame(handle)
      frame.setProgress(restingProgress)
    }
  }, [playing, state.status, environment.reducedMotion])

  // Judged in the same render as a new scenario revision arrives, so the shell never acknowledges a frame still loading.
  const drawn = !scenario.subject || custom || (state.entity === entity && (state.status === 'ready' || state.status === 'failed'))
  usePaintGate(near === false || (near === true && drawn))

  return (
    <div className="gl-stage pk-frame" data-state={custom ? 'custom' : state.status}>
      {custom ? (
        <p className="gl-stage-note">
          <span>
            Drawn by the custom renderer in <code className="pk-identifier">{scenario.bundle}</code>. Hosts nest only built-in renderers.
          </span>
        </p>
      ) : !scenario.subject ? (
        <p className="gl-stage-note">This scenario has nothing to draw.</p>
      ) : !drawable ? (
        <p className="gl-stage-note">An image of the gallery draws its first scenario sets. Open the gallery to see this one.</p>
      ) : (
        state.status === 'failed' && (
          <p className="gl-stage-note" role="status">
            {state.message}
          </p>
        )
      )}
      <div ref={host} className="gl-stage-frame" aria-busy={state.status === 'loading'} />
    </div>
  )
}

/**
 * Runs a scenario's renderer in `container` once a load slot is free, and reports how it ends: drawn, or failed (a
 * refused document, no `ready`, an `error`, or no first paint within `paintTimeoutMs`). Either frees the slot, so a
 * renderer that fails never holds back the queue, and a failure is final: a later paint doesn't make the card drawn.
 * Returns what stops it.
 *
 * @internal
 */
export function loadNested(
  container: HTMLElement,
  scenario: Scenario,
  requestDocument: (name: string) => Promise<string>,
  hooks: {
    present: (declared: RendererCapabilities) => NonNullable<ReturnType<typeof nestedPresentation>>
    label: () => string
    colorMode: () => RendererEnvironment['theme']['colorMode']
    started: (frame: EmbeddedRenderer) => void
    animated: (animated: boolean) => void
    select: () => void
    settled: (state: {status: 'ready'} | {status: 'failed'; message: string}) => void
  },
): () => void {
  const view = container.ownerDocument.defaultView ?? globalThis.window
  let frame: EmbeddedRenderer | undefined
  let cancelled = false
  let failed = false
  let paint = 0
  let release: (() => void) | undefined
  const fail = (message: string) => {
    view.clearTimeout(paint)
    release?.()
    if (failed || cancelled) return
    failed = true
    hooks.settled({status: 'failed', message})
  }
  // A few renderers load at once, the rest queue, so a gallery drawn whole (an image of it) doesn't start dozens.
  void loads.acquire().then(free => {
    release = free
    if (cancelled) {
      free()
      return
    }
    frame = embedRenderer({requestDocument}, container, {
      renderer: scenario.renderer,
      title: hooks.label(),
      colorMode: hooks.colorMode(),
      init: declared => hooks.present(declared).init,
      progress: declared => {
        const {progress} = hooks.present(declared)
        hooks.animated(progress !== undefined)
        return progress
      },
      ...(scenario.presentation?.rendererOptions ? {options: scenario.presentation.rendererOptions} : {}),
      onMessage: message => {
        if (message.type === 'ready') {
          paint = view.setTimeout(() => fail(`The ${scenario.renderer} renderer did not draw this scenario`), paintTimeoutMs)
        } else if (message.type === 'rendered' && !failed) {
          view.clearTimeout(paint)
          free()
          hooks.settled({status: 'ready'})
        } else if (message.type === 'error') fail(message.message)
        else if (message.type === 'select' && message.id !== null) hooks.select()
      },
      onFailure: fail,
    })
    hooks.started(frame)
  })
  return () => {
    cancelled = true
    view.clearTimeout(paint)
    release?.()
    frame?.dispose()
  }
}

function withoutPane(environment: RendererEnvironment): RendererEnvironment {
  const {pane: _pane, ...rest} = environment
  return rest
}
