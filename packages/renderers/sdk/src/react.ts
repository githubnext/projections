import {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react'
import type {Extraction} from '@githubnext/projections-schemas'
import {connectInteractions, type InteractionController, type InteractionOptions} from './interactions.js'
import {afterPaint, applyEnvironment, connectRenderer, type RendererClient} from './client.js'
import {
  acceptsExtraction,
  controlValues,
  describeAccepts,
  type AcceptedExtraction,
  type RendererAccepts,
  type AnnotationMark,
  type ControlValue,
  type FilterPayload,
  type InitPayload,
  type ProgressPayload,
  type RendererCapabilities,
  type RendererControl,
  type RendererEnvironment,
  type RendererOptions,
} from './protocol.js'

/** The host state `useRenderer` keeps, each field as the host last sent it. */
export interface RendererState<X extends Extraction = Extraction> {
  /** The extraction or comparison to present; undefined until the host sends `init`, or when the renderer doesn't accept it. */
  init: InitPayload<X> | undefined
  /**
   * The position to draw. `{progress: 1, highlighting: 0, direction: 1}` until the host sends one and for an
   * extraction; `{progress: 1, highlighting: 1, direction: 1}` for a comparison in diff mode until the host sends one.
   */
  progress: ProgressPayload
  /** The item the host selected, or `null`; the renderer's own `client.select` calls don't change it. */
  selection: string | null
  /** The selected property of `selection` (an RFC 6901 pointer), when the host selected one. */
  selectionPath: string | undefined
  /** Increments for every host `select` message, so a repeated value is still observable. */
  selectionVersion: number
  /** The host's latest `annotations` (capability `annotations`); empty until it sends any. */
  annotations: AnnotationMark[]
  /** The entity the host says is hovered in any pane, or `null`. */
  hovered: string | null
  /** The host's latest `options` (control values by ID); `{}` until it sends any. Prefer `controlValues`. */
  options: RendererOptions
  /** The frame's size in CSS px from the host's `viewport`; undefined until it sends one. */
  viewport: {width: number; height: number} | undefined
  /** The theme, motion preference, locale and pane from `init` or a later `environment`; undefined until `init`. */
  environment: RendererEnvironment | undefined
  /**
   * The host's scope, summary filter and find (capability `filter`); undefined until it sends one. Kept from the
   * first message: a host sends the filter it has chosen right after `init`, before a later subscriber could see it.
   */
  filter: FilterPayload | undefined
}

/** What `useRenderer` declares and how it behaves. */
export interface UseRendererOptions<A extends readonly RendererAccepts[] | undefined = undefined> {
  /** What the renderer supports, posted in `ready`. Read once on mount: later changes are ignored. */
  capabilities: RendererCapabilities
  /**
   * The extractions the renderer presents, as its manifest declares them (`rendererConfig({accepts})`). It
   * types `init`, and an extraction outside it is refused with a `failure` rather than presented.
   */
  accepts?: A
  /**
   * Acknowledge every committed progress value after it is painted (default
   * true). Set false when painting is asynchronous and call `client.rendered`
   * yourself.
   */
  acknowledge?: boolean
  /** Apply the host theme and reduced-motion preference to the document element (default true). */
  applyTheme?: boolean
  /** Called when the person activates one of the declared `action` controls. */
  onAction?: (id: string) => void
}

const initialProgress: ProgressPayload = {progress: 1, highlighting: 0, direction: 1}
/**
 * Diff mode has no progress: the renderer shows both subjects at once, fully
 * highlighted. A host that turns highlighting off may still send one
 * `progress` with `highlighting: 0`, which then applies.
 */
const diffProgress: ProgressPayload = {progress: 1, highlighting: 1, direction: 1}

/** Whether the host presents this comparison in `diff` mode: one static frame, no `progress`. */
export function isDiff(init: InitPayload | undefined): boolean {
  return init?.mode === 'comparison' && init.comparisonMode === 'diff'
}

/** The extraction a renderer that accepts `A` receives: any extraction when it declares nothing. */
export type ExtractionAccepted<A extends readonly RendererAccepts[] | undefined> = A extends readonly RendererAccepts[]
  ? AcceptedExtraction<A>
  : Extraction

/** Why a renderer that accepts `accepts` refuses `init`, or undefined when it presents it. */
export function refusal(accepts: readonly RendererAccepts[] | undefined, init: InitPayload): string | undefined {
  const sides = init.mode === 'extraction' ? [init.extraction] : [init.before, init.after]
  const refused = sides.find(side => !acceptsExtraction(accepts, side))
  if (!refused || !accepts) return undefined
  const vocabularies =
    refused.vocabularies?.length !== undefined && refused.vocabularies.length > 0
      ? ` with ${refused.vocabularies.map(name => `\`${name}\``).join(', ')}`
      : ''
  return `This renderer presents ${describeAccepts(accepts)}; this extraction is \`${refused.schema}\`${vocabularies}.`
}

/**
 * React binding for the renderer frame protocol. Connects once on mount (`connectRenderer`), keeps the latest host
 * state, applies the host theme to the document element (unless `applyTheme` is false), and by default acknowledges
 * each rendered progress value after the browser paints it. `client` is undefined until connected, and stays so if
 * connecting failed, in which case `failure` explains why; `failure` also explains an `init` the renderer's `accepts`
 * refuses. Disconnects on unmount.
 *
 * @example
 * ```tsx
 * function Renderer() {
 *   const {init, progress, client, failure} = useRenderer({capabilities: {changeHighlighting: 'supported'}})
 *   if (failure) return <p role="alert">{failure}</p>
 *   if (!init || !client) return null
 *   return <Diagram init={init} progress={progress} onSelect={(id: string | null) => client.select(id)} />
 * }
 * ```
 */
export function useRenderer<const A extends readonly RendererAccepts[] | undefined = undefined>(
  options: UseRendererOptions<A>,
): RendererState<ExtractionAccepted<A>> & {
  client: RendererClient | undefined
  failure: string | undefined
  /** The value of each declared control (from `capabilities.controls` or `useDeclaredOptions`), defaults filled in. */
  controlValues: Record<string, ControlValue>
} {
  const [state, setState] = useState<RendererState>({
    init: undefined,
    progress: initialProgress,
    selection: null,
    selectionPath: undefined,
    selectionVersion: 0,
    annotations: [],
    hovered: null,
    options: {},
    viewport: undefined,
    environment: undefined,
    filter: undefined,
  })
  // Its own refusal of the host's `init`, as `init` last came.
  const [refused, setRefused] = useState<string>()
  // The connection to the host, which the effect below makes.
  const [connection] = useState(() => new HostConnection())
  const connected = useSyncExternalStore(connection.subscribe, connection.get, connection.get)
  const client = connected.client
  const failure = connected.failure ?? refused
  // Declared once, as the renderer connects.
  const [capabilities] = useState(options.capabilities)
  const [accepts] = useState(options.accepts)
  const actionRef = useRef(options.onAction)
  useLayoutEffect(() => {
    actionRef.current = options.onAction
  })
  const applyTheme = options.applyTheme !== false
  useEffect(() => {
    const environment = (value: RendererEnvironment) => {
      if (applyTheme) applyEnvironment(value)
      setState(previous => ({...previous, environment: value}))
    }
    return connection.connect(() =>
      connectRenderer(
        {
          init(init) {
            if (applyTheme) applyEnvironment(init)
            const refusing = refusal(accepts, init)
            setRefused(refusing)
            setState(previous => ({
              ...previous,
              init: refusing ? undefined : init,
              environment: {
                theme: init.theme,
                reducedMotion: init.reducedMotion,
                locale: init.locale,
                ...(init.pane === undefined ? {} : {pane: init.pane}),
                ...(init.sizing === undefined ? {} : {sizing: init.sizing}),
              },
              progress: init.mode === 'extraction' ? initialProgress : isDiff(init) ? diffProgress : previous.progress,
            }))
          },
          progress: progress => setState(previous => ({...previous, progress})),
          select: ({id, path}) =>
            setState(previous => ({...previous, selection: id, selectionPath: path, selectionVersion: previous.selectionVersion + 1})),
          annotations: annotations => setState(previous => ({...previous, annotations})),
          options: value => setState(previous => ({...previous, options: value})),
          hover: ({id}) => setState(previous => ({...previous, hovered: id})),
          action: ({id}) => actionRef.current?.(id),
          viewport: viewport => setState(previous => ({...previous, viewport})),
          environment,
          filter: filter => setState(previous => ({...previous, filter})),
        },
        {capabilities},
      ),
    )
  }, [connection, capabilities, accepts, applyTheme])
  const acknowledge = options.acknowledge !== false
  const {init, progress} = state
  useEffect(() => {
    if (!client || !acknowledge || !init) return undefined
    return afterPaint(() => client.rendered(progress.progress, init))
  }, [client, acknowledge, init, progress])
  const [declared] = useState(() => capabilities.controls ?? [])
  const values = useMemo(() => controlValues(declared, state.options), [declared, state.options])
  // `init` passed `refusal`, so its extractions are the ones `A` accepts.
  return useMemo(
    () => ({...(state as RendererState<ExtractionAccepted<A>>), client, failure, controlValues: values}),
    [state, client, failure, values],
  )
}

/** A renderer's connection to its host, made in an effect: its client once connected, else why it couldn't connect. */
class HostConnection {
  #state: {client?: RendererClient | undefined; failure?: string | undefined} = {}
  readonly #listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  readonly get = () => this.#state

  /** Connects with `connect`, and returns how to disconnect. */
  connect(connect: () => RendererClient): () => void {
    let client: RendererClient
    try {
      client = connect()
    } catch (error) {
      this.#set({failure: error instanceof Error ? error.message : String(error)})
      return () => undefined
    }
    this.#set({client})
    return () => client.dispose()
  }

  #set(state: {client?: RendererClient; failure?: string}) {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}

/**
 * Connects `connectInteractions` to a rendered root element: hover, anchors
 * for the connector between panes, scroll mirroring, the host's filter and
 * annotation badges. Pass the renderer's current selection so its anchor
 * follows it, and `options.select` (usually the renderer's own select
 * handler, which also calls `client.select`) so activating a badge updates
 * it. Declare `interactionCapabilities` in `useRenderer`'s capabilities.
 */
export function useInteractions(
  client: RendererClient | undefined,
  root: RefObject<HTMLElement | null>,
  selected: string | null,
  options: InteractionOptions = {},
): void {
  const controller = useRef<InteractionController | null>(null)
  const attribute = options.attribute
  const select = useRef(options.select)
  const partOf = useRef(options.partOf)
  useLayoutEffect(() => {
    select.current = options.select
    partOf.current = options.partOf
  })
  useEffect(() => {
    if (!client || !root.current) return undefined
    const created = connectInteractions(client, root.current, {
      ...(attribute ? {attribute} : {}),
      select: id => (select.current ? select.current(id) : client.select(id)),
      partOf: id => partOf.current?.(id),
    })
    controller.current = created
    return () => {
      created.dispose()
      controller.current = null
    }
  }, [client, root, attribute])
  useEffect(() => {
    controller.current?.setSelected(selected)
  }, [selected, client])
  // A new `partOf` (a new document) marks the filter again.
  useEffect(() => controller.current?.refresh(), [options.partOf])
}

/**
 * Declares controls after connecting, for example when they depend on the
 * document (a renderer with static controls declares them in
 * `capabilities.controls` instead). Re-declares whenever `controls` changes by
 * value. Returns each control's current value from the host's `options`.
 */
export function useDeclaredOptions(
  client: RendererClient | undefined,
  controls: readonly RendererControl[],
  options: RendererOptions,
): Record<string, ControlValue> {
  const key = JSON.stringify(controls)
  useEffect(() => {
    if (client) client.declareOptions(JSON.parse(key) as RendererControl[])
  }, [client, key])
  return useMemo(() => controlValues(JSON.parse(key) as RendererControl[], options), [key, options])
}
