import {useEffect, useMemo, useRef, useState} from 'react'
import {useMachine} from '@githubnext/projections-machine/react'
import type {ReactNode} from 'react'
import type {
  AnchorRect,
  AnnotationMark,
  ControlValue,
  FilterPayload,
  RendererLegend,
  SummaryItem,
  InitPayload,
  ProgressPayload,
  RendererCapabilities,
  RendererControl,
  RendererEnvironment,
  RendererOptions,
  ScrollPosition,
} from '@githubnext/projections-renderer-sdk/protocol'
import {RendererFrame} from './frame.js'
import type {RendererFrameEvent} from './frame/types.js'
import type {RendererDocuments, RendererEntry} from './registry.js'
import {loadingLifecycle, paneLifecycle, paneStateOf} from './pane-lifecycle.js'

/**
 * What a `RendererPane` reports through `onState`: its frame's status (with the failure `message`), the renderer's
 * capabilities, steps and controls once it is ready, its last five reported errors and how many of its messages were
 * `rejected`.
 */
export interface PaneState {
  /** `ready` once the frame has painted with the host theme and is visible; until then the host shows its own loading state. */
  status: 'loading' | 'ready' | 'failed'
  message?: string
  capabilities?: RendererCapabilities
  /** The progress the renderer last acknowledged painting. */
  rendered?: number
  /** The `init` that acknowledgement answers: until the pane catches up with a new one, `rendered` is the old one's. */
  renderedInit?: InitPayload
  steps: number[]
  /** How many step slots the renderer's presentation spans, when it reports more than its steps. */
  stepSlots?: number
  rendererErrors: string[]
  rejected: number
  /** Controls the renderer declares, for the host to draw. */
  controls: RendererControl[]
  /** The renderer's legend, for the host to draw once outside the panes. */
  legend?: RendererLegend
  /** The renderer's words for the summary bar (its `summary`), when it sent any. */
  summary?: SummaryItem[]
  /** The shape (width / height) of the content the renderer fits to its stage, if it reports one. */
  aspect?: number
  /**
   * The height, CSS px, the renderer last asked its frame for: its content's height, or while it fills its frame the
   * height it prefers. A host that sizes the frame itself can use it to fit its own box to the content.
   */
  height?: number
}

export const loadingPane: PaneState = {status: 'loading', steps: [], rendererErrors: [], rejected: 0, controls: []}

/**
 * The props of `RendererPane`: the bundle and the state to send it (`init`, progress, selection, options), and the
 * callbacks its renderer's events come back through.
 */
export interface RendererPaneProps {
  renderer: RendererEntry
  /** Built-in renderer documents for a renderer that nests them (`RendererFrameOptions.builtinDocuments`). */
  documents?: RendererDocuments | undefined
  /** Appended to the frame's accessible name, for example `before revision`. */
  label?: string
  init: InitPayload
  /** The presentation position; omitted in diff mode, where the renderer draws a static comparison. */
  progress?: ProgressPayload | undefined
  environment: RendererEnvironment
  selectedId: string | null
  hoveredId: string | null
  /** Option values sent to the renderer, keyed by control ID. */
  options?: RendererOptions
  /** The host's find and "changes only" settings. */
  filter?: FilterPayload
  /** Increments to deliver each action request; `{id, sequence}`. */
  action?: {id: string; sequence: number} | undefined
  comparing: boolean
  /** The selected property of the selected item, if any. */
  selectedPath?: string | undefined
  /** Markers to draw on items, if the renderer supports them. */
  annotations?: AnnotationMark[]
  onSelect: (id: string | null, path?: string) => void
  /** The person activated an item's annotation marker. */
  onAnnotation?: (id: string) => void
  /** The person set a declared control from the renderer's content; apply it as a change in the host's settings. */
  onControl?: (id: string, value: ControlValue) => void
  onHover: (id: string | null) => void
  onOpen: (path: string, line?: number) => void
  onAnchor?: (id: string, rect: AnchorRect | null) => void
  onViewport?: (position: ScrollPosition) => void
  onState: (state: PaneState) => void
  /** Renders the pane's loading or failure state; the frame itself is appended after it. */
  status?: ((state: PaneState, side: 'before' | 'after' | 'main') => ReactNode) | undefined
  /** Fill the container's height instead of the renderer's requested height. */
  fill?: boolean
  /** Receives the pane's frame controller, for scroll mirroring and measuring. */
  frameRef?: (frame: RendererFrame | null) => void
  /** How far, CSS px, the frame extends past the pane's start and end edges (see `ProjectionStageProps.bleed`). */
  bleed?: {start: number; end: number}
}

const noDocuments = "This host doesn't supply renderer documents"

/** One sandboxed renderer frame with its loading and failure states. */
export function RendererPane(props: RendererPaneProps) {
  const {renderer, init, progress, environment, selectedId, hoveredId} = props
  const container = useRef<HTMLDivElement>(null)
  const frame = useRef<RendererFrame | null>(null)
  const [lifecycle, send] = useMachine(paneLifecycle, {state: loadingLifecycle})
  const state = useMemo(() => paneStateOf(lifecycle), [lifecycle])
  // Counts the renderer's `control` messages, each answered with the options once the host has applied it.
  const [controlAnswer, setControlAnswer] = useState(0)
  const callbacks = useRef(props)
  callbacks.current = props
  const options = props.options
  const selectedPath = props.selectedPath
  const annotations = props.annotations
  const fill = props.fill ?? false
  const latest = useRef({init, progress, selectedId, hoveredId, options, selectedPath, annotations, fill})
  latest.current = {init, progress, selectedId, hoveredId, options, selectedPath, annotations, fill}
  // A pane can move between roles (the animated frame becomes the after pane), so a new `onState` gets the current state.
  const onState = props.onState
  useEffect(() => {
    onState(state)
  }, [state, onState])

  // The init the frame was last given, so an acknowledgement records the one it answers: the frame drops a renderer's
  // acknowledgement of an earlier init (renderers that echo its generation), and the ref changes with `setInit`.
  const initialized = useRef(init)
  const url = renderer.url
  const title = props.label ? `${renderer.title} renderer, ${props.label}` : `${renderer.title} renderer`
  const titleRef = useRef(title)
  titleRef.current = title
  useEffect(() => {
    const host = container.current
    if (!host) return undefined
    send({type: 'reloaded'})
    const onEvent = (event: RendererFrameEvent) => {
      const current = callbacks.current
      switch (event.type) {
        case 'rendered':
          send({...event, init: initialized.current})
          break
        case 'ready':
        case 'revealed':
        case 'controls':
        case 'failed':
        case 'steps':
        case 'aspect':
        case 'height':
        case 'legend':
        case 'summary':
        case 'error':
          send(event)
          break
        case 'rejected':
          send({type: 'rejected'})
          break
        case 'select':
          current.onSelect(event.id, event.path)
          break
        case 'annotation':
          current.onAnnotation?.(event.id)
          break
        case 'control':
          current.onControl?.(event.id, event.value)
          // Answer with the options as they stand once applied, so a value the host or its embedder declined is undone.
          setControlAnswer(previous => previous + 1)
          break
        case 'hover':
          current.onHover(event.id)
          break
        case 'anchor':
          current.onAnchor?.(event.id, event.rect)
          break
        case 'viewport':
          current.onViewport?.({x: event.x, y: event.y, ...(event.key === undefined ? {} : {key: event.key})})
          break
        case 'open':
          current.onOpen(event.path, event.line)
          break
      }
    }
    const created = new RendererFrame({
      container: host,
      url,
      title: titleRef.current,
      init: latest.current.init,
      ...(latest.current.progress ? {progress: latest.current.progress} : {}),
      selection: latest.current.selectedId,
      ...(latest.current.options ? {options: latest.current.options} : {}),
      onEvent,
      fill: latest.current.fill,
      // The latest supply, so a catalog that loads after the frame still answers its requests.
      builtinDocuments: name => callbacks.current.documents?.(name) ?? Promise.reject(new Error(noDocuments)),
    })
    if (latest.current.hoveredId !== null) created.hover(latest.current.hoveredId)
    if (latest.current.selectedPath !== undefined) created.select(latest.current.selectedId, latest.current.selectedPath)
    const annotations = latest.current.annotations
    if (annotations !== undefined && annotations.length > 0) created.annotations(annotations)
    frame.current = created
    callbacks.current.frameRef?.(created)
    return () => {
      created.dispose()
      if (frame.current === created) frame.current = null
      callbacks.current.frameRef?.(null)
    }
    // `send` is the pane's actor's, the same for its life.
  }, [url, send])
  useEffect(() => {
    frame.current?.setTitle(title)
  }, [title])
  useEffect(() => {
    frame.current?.setFill(fill)
  }, [fill])
  useEffect(() => {
    if (initialized.current === init) return
    initialized.current = init
    send({type: 'reinit'})
    frame.current?.setInit(init, latest.current.progress)
  }, [init, send])
  useEffect(() => {
    if (progress) frame.current?.setProgress(progress)
  }, [progress])
  useEffect(() => {
    frame.current?.select(selectedId, selectedPath)
  }, [selectedId, selectedPath])
  useEffect(() => {
    if (annotations) frame.current?.annotations(annotations)
  }, [annotations, state.status])
  useEffect(() => {
    frame.current?.hover(hoveredId)
  }, [hoveredId, state.status])
  useEffect(() => {
    frame.current?.setEnvironment(environment)
  }, [environment])
  useEffect(() => {
    if (options) frame.current?.setOptions(options)
  }, [options])
  useEffect(() => {
    if (controlAnswer) frame.current?.setOptions(latest.current.options ?? {})
  }, [controlAnswer])
  const filter = props.filter
  useEffect(() => {
    if (filter) frame.current?.filter(filter)
  }, [filter, state.status])
  const action = props.action
  useEffect(() => {
    if (action) frame.current?.action(action.id)
  }, [action])

  // The status slot always precedes the frame. While the frame loads (transparent), its status overlays the frame's
  // whole area, centered in it, so revealing the frame doesn't move anything.
  const loading = state.status === 'loading'
  return (
    <div
      className="ph-frame-host"
      ref={container}
      data-renderer={renderer.name}
      data-renderer-status={state.status}
      data-rendered-progress={state.rendered ?? ''}
      style={{
        position: 'relative',
        display: 'grid',
        gap: 8,
        minWidth: 0,
        background: 'var(--projections-color-bg, transparent)',
        ...(fill ? {display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0} : {}),
        ...(props.bleed ? {marginInlineStart: -props.bleed.start, marginInlineEnd: -props.bleed.end} : {}),
      }}
    >
      <div
        className="ph-pane-status-slot"
        style={
          loading
            ? {
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }
            : {display: 'contents'}
        }
      >
        {props.status?.(state, props.label?.startsWith('before') ? 'before' : props.label?.startsWith('after') ? 'after' : 'main')}
      </div>
    </div>
  )
}
