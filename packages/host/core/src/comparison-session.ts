import {useLayoutEffect, useRef, useState} from 'react'
import type {Highlighting, PresentationDefaults} from './projection/types.js'
import type {ComparisonMode} from './modes.js'
import {offeredModes, type ProjectionFeatures} from './view-model.js'

/**
 * The options of `useComparisonSession`: the definition's defaults, the features (for the modes offered), and each
 * setting, controlled (with its `on…Change`) or left to the session (optionally seeded with `initial…`).
 */
export interface ComparisonSessionOptions {
  /** The definition's defaults (`ComparisonPair.presentation`), applied as initial values. */
  presentation?: PresentationDefaults | undefined
  /** Only `modes` is read: an initial mode the features don't offer gives way to the first they offer. */
  features?: Pick<ProjectionFeatures, 'modes'> | undefined
  mode?: ComparisonMode | undefined
  initialMode?: ComparisonMode | undefined
  onModeChange?: ((mode: ComparisonMode) => void) | undefined
  swipePosition?: number | undefined
  onSwipePositionChange?: ((position: number) => void) | undefined
  highlighting?: Highlighting | undefined
  onHighlightingChange?: ((highlighting: Highlighting) => void) | undefined
  changesOnly?: boolean | undefined
  /** The scope a session starts in: the definition's `presentation.changesOnly`, else Changes (`true`). */
  initialChangesOnly?: boolean | undefined
  onChangesOnlyChange?: ((changesOnly: boolean) => void) | undefined
  search?: string | undefined
  onSearchChange?: ((search: string) => void) | undefined
  connector?: boolean | undefined
  initialConnector?: boolean | undefined
  onConnectorChange?: ((connector: boolean) => void) | undefined
  loop?: boolean | undefined
  initialLoop?: boolean | undefined
  onLoopChange?: ((loop: boolean) => void) | undefined
}

/**
 * The settings a session keeps across pairs, as controlled values with their handlers, ready for `useProjection` or a
 * view. `mode` is absent until one is chosen, so the renderer's default applies.
 */
export interface ComparisonSessionSettings {
  mode?: ComparisonMode
  onModeChange: (mode: ComparisonMode) => void
  swipePosition: number
  onSwipePositionChange: (position: number) => void
  highlighting: Highlighting
  onHighlightingChange: (highlighting: Highlighting) => void
  changesOnly: boolean
  onChangesOnlyChange: (changesOnly: boolean) => void
  search: string
  onSearchChange: (search: string) => void
  connector: boolean
  onConnectorChange: (connector: boolean) => void
  loop: boolean
  onLoopChange: (loop: boolean) => void
}

/** The settings a session keeps, and the handler each reports its changes to. */
const handlerOf = {
  mode: 'onModeChange',
  swipePosition: 'onSwipePositionChange',
  highlighting: 'onHighlightingChange',
  changesOnly: 'onChangesOnlyChange',
  search: 'onSearchChange',
  connector: 'onConnectorChange',
  loop: 'onLoopChange',
} as const satisfies Partial<Record<keyof ComparisonSessionOptions, keyof ComparisonSessionOptions>>
type Controlled = keyof typeof handlerOf

/**
 * Where a session's settings start: each `initial…` option, else the definition's `presentation`, else the shared
 * default (no mode, so the renderer's default applies; the divider centred; animated highlighting; Changes; no find,
 * no connector; loop on). An initial mode the features don't offer gives way to the first they offer.
 */
export function comparisonSessionDefaults(
  options: Pick<
    ComparisonSessionOptions,
    'presentation' | 'features' | 'initialMode' | 'initialChangesOnly' | 'initialConnector' | 'initialLoop'
  >,
): Omit<ComparisonSessionSettings, `on${string}`> {
  const {presentation, features} = options
  const initial = options.initialMode ?? presentation?.mode
  const modes = offeredModes(features)
  const limited = features?.modes !== undefined && features.modes !== false
  const mode = initial && modes.includes(initial) ? initial : limited ? modes[0] : undefined
  return {
    ...(mode ? {mode} : {}),
    swipePosition: 0.5,
    highlighting: presentation?.highlighting ?? 'animated',
    changesOnly: options.initialChangesOnly ?? presentation?.changesOnly ?? true,
    search: '',
    connector: options.initialConnector ?? false,
    loop: options.initialLoop ?? true,
  }
}

/**
 * The settings a person chooses while comparing (the mode, the swipe divider, highlighting, the scope, find, the
 * connector and loop), kept while they move between pairs: a pair picker's view remounts for each new comparison, so
 * the settings live here, above it. They start from `comparisonSessionDefaults`; each is controllable.
 */
export function useComparisonSession(options: ComparisonSessionOptions): ComparisonSessionSettings {
  // The committed render's options, for the handlers.
  const latest = useRef(options)
  useLayoutEffect(() => {
    latest.current = options
  })
  const [defaults] = useState(() => comparisonSessionDefaults(options))
  const [mode, setMode] = useState<ComparisonMode | undefined>(defaults.mode)
  const [swipePosition, setSwipePosition] = useState(defaults.swipePosition)
  const [highlighting, setHighlighting] = useState<Highlighting>(defaults.highlighting)
  const [changesOnly, setChangesOnly] = useState(defaults.changesOnly)
  const [search, setSearch] = useState(defaults.search)
  const [connector, setConnector] = useState(defaults.connector)
  const [loop, setLoop] = useState(defaults.loop)
  // One handler per setting for the session's life, so views don't see new callbacks on every render.
  const [handlers] = useState(() => ({
    onModeChange: (value: ComparisonMode) => change(latest.current, 'mode', setMode, value),
    onSwipePositionChange: (value: number) => change(latest.current, 'swipePosition', setSwipePosition, value),
    onHighlightingChange: (value: Highlighting) => change(latest.current, 'highlighting', setHighlighting, value),
    onChangesOnlyChange: (value: boolean) => change(latest.current, 'changesOnly', setChangesOnly, value),
    onSearchChange: (value: string) => change(latest.current, 'search', setSearch, value),
    onConnectorChange: (value: boolean) => change(latest.current, 'connector', setConnector, value),
    onLoopChange: (value: boolean) => change(latest.current, 'loop', setLoop, value),
  }))
  const shownMode = options.mode ?? mode
  return {
    ...(shownMode ? {mode: shownMode} : {}),
    swipePosition: options.swipePosition ?? swipePosition,
    highlighting: options.highlighting ?? highlighting,
    changesOnly: options.changesOnly ?? changesOnly,
    search: options.search ?? search,
    connector: options.connector ?? connector,
    loop: options.loop ?? loop,
    ...handlers,
  }
}

/**
 * A setting changed in a view. One the embedder controls keeps its value: the change is only requested, so a refused
 * one isn't kept for later.
 */
function change<K extends Controlled>(
  options: ComparisonSessionOptions,
  key: K,
  set: (value: NonNullable<ComparisonSessionOptions[K]>) => void,
  value: NonNullable<ComparisonSessionOptions[K]>,
): void {
  const notify = options[handlerOf[key]] as ((value: NonNullable<ComparisonSessionOptions[K]>) => void) | undefined
  if (options[key] === undefined) set(value)
  notify?.(value)
}
