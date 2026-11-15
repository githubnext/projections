import {useCallback, useRef, useState} from 'react'
import {CircleAlert} from 'lucide-react'
import {ComparisonError} from '../compare.js'
import {useComparisonPair} from '../pair.js'
import type {ComparisonPairOptions} from '../pair.js'
import {LoadingStatus} from '../loading.js'
import {ProjectionView} from './view.js'
import type {ProjectionViewProps} from './view/props.js'
import type {ComparisonMode} from '../modes.js'
import type {Highlighting} from '../projection.js'
import {Alert, AlertDescription, AlertTitle} from './components/alert.js'
import {Button} from './components/button.js'
import {ScopedRoot} from './components/scoped-root.js'
import {useColorMode} from './lib/color-mode.js'
import {cn} from './lib/utils.js'
import {PairPicker, Toolbar} from './blocks.js'
import type {PairForm} from './blocks.js'
export type {ExtractionChoice} from '../pair.js'

/**
 * The props of `ComparisonExplorer`: the extractions to pair and their controlled pair (`ComparisonPairOptions`), and
 * the view props it passes through to `ProjectionView`.
 */
export interface ComparisonExplorerProps
  extends
    ComparisonPairOptions,
    Pick<
      ProjectionViewProps,
      | 'colorMode'
      | 'themeTokens'
      | 'durationMs'
      | 'diagnostics'
      | 'notices'
      | 'onOpen'
      | 'onSelectionChange'
      | 'annotations'
      | 'onAnnotationActivate'
      | 'renderDetails'
      | 'details'
      | 'evidenceLink'
      | 'controllerRef'
      | 'onProgressChange'
      | 'initialView'
      | 'progress'
      | 'playing'
      | 'onPlayingChange'
      | 'mode'
      | 'initialMode'
      | 'onModeChange'
      | 'swipePosition'
      | 'onSwipePositionChange'
      | 'loop'
      | 'initialLoop'
      | 'onLoopChange'
      | 'initialHolds'
      | 'connector'
      | 'initialConnector'
      | 'onConnectorChange'
      | 'highlighting'
      | 'onHighlightingChange'
      | 'changesOnly'
      | 'onChangesOnlyChange'
      | 'search'
      | 'onSearchChange'
      | 'controlValues'
      | 'onControlChange'
      | 'onAction'
      | 'features'
      | 'actions'
      | 'fill'
      | 'className'
    > {}

/**
 * The default pair picker: lets a user choose any two extractions from a set
 * and presents their comparison, computed in the browser with the projection's
 * comparator (see `useComparisonPair`). Choosing no base shows one extraction.
 * Its `PairPicker` starts the view's toolbar row; like the view, it fills its
 * container's height unless `fill` is false.
 */
export function ComparisonExplorer(props: ComparisonExplorerProps) {
  const pair = useComparisonPair(props)
  const callbacks = useRef(props)
  callbacks.current = props
  const colorMode = useColorMode(props.colorMode)
  // The view unmounts while a new pair is computed, so the explorer keeps the uncontrolled mode and divider.
  // Undefined until chosen: the renderer's default mode applies.
  const [mode, setMode] = useState<ComparisonMode | undefined>(props.initialMode ?? pair.presentation?.mode)
  const [swipe, setSwipe] = useState(0.5)
  const [highlighting, setHighlighting] = useState<Highlighting>(pair.presentation?.highlighting ?? 'animated')
  const [changesOnly, setChangesOnly] = useState(pair.presentation?.changesOnly ?? false)
  const [search, setSearch] = useState('')
  const settings = {
    highlighting: props.highlighting ?? highlighting,
    onHighlightingChange: (value: Highlighting) => {
      setHighlighting(value)
      callbacks.current.onHighlightingChange?.(value)
    },
    changesOnly: props.changesOnly ?? changesOnly,
    onChangesOnlyChange: (value: boolean) => {
      setChangesOnly(value)
      callbacks.current.onChangesOnlyChange?.(value)
    },
    search: props.search ?? search,
    onSearchChange: (value: string) => {
      setSearch(value)
      callbacks.current.onSearchChange?.(value)
    },
  }
  const changeMode = useCallback((value: ComparisonMode) => {
    setMode(value)
    callbacks.current.onModeChange?.(value)
  }, [])
  const changeSwipe = useCallback((value: number) => {
    setSwipe(value)
    callbacks.current.onSwipePositionChange?.(value)
  }, [])
  const {after, outcome, subject, document, resolution} = pair
  const fill = props.fill !== false
  if (!after || !document)
    return (
      <ScopedRoot colorMode={colorMode} className={cn('ph-explorer', props.className)}>
        <p
          role="status"
          className="ph-notice pj:rounded-lg pj:border pj:border-divider pj:bg-surface-raised pj:p-4 pj:text-sm pj:text-muted-foreground"
        >
          No extractions are available for this projection.
        </p>
      </ScopedRoot>
    )
  const comparator = outcome.status === 'compared' ? outcome.result.comparator : undefined
  const picker = (compact: boolean, form?: PairForm) => <PairPicker pair={pair} form={form ?? (compact ? 'merged' : 'full')} />
  return (
    <ScopedRoot
      colorMode={colorMode}
      className={cn('ph-explorer', props.className)}
      data-outcome={outcome.status}
      data-fill={fill || undefined}
    >
      {!subject && (
        <Toolbar>
          <div className="ph-toolbar-start pj:flex pj:min-w-0">{picker(false)}</div>
        </Toolbar>
      )}
      {outcome.status === 'computing' && (
        <LoadingStatus className="ph-computing" label="Computing the comparison in this browser…" fill={fill} />
      )}
      {outcome.status === 'failed' && (
        <Alert
          variant="destructive"
          className="ph-error pj:rounded-none pj:border-0 pj:border-b pj:border-divider pj:bg-surface-raised"
          data-error-code={outcome.error instanceof ComparisonError ? outcome.error.code : 'error'}
        >
          <CircleAlert className="pj:h-4 pj:w-4" />
          <AlertTitle>These extractions can't be compared.</AlertTitle>
          <AlertDescription className="pj:flex pj:flex-col pj:gap-2">
            <p className="pj:break-words">{outcome.error.message}</p>
            {outcome.error instanceof ComparisonError && outcome.error.details.length > 0 && (
              <ul className="pj:list-disc pj:pl-4 pj:text-foreground/80">
                {outcome.error.details.map((detail, index) => (
                  <li key={index} className="pj:break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
            <p className="pj:flex pj:flex-wrap pj:gap-2">
              <Button type="button" variant="outline" size="sm" className="pj:text-foreground" onClick={() => pair.setBefore('')}>
                Show {after.label} on its own
              </Button>
              <Button type="button" variant="outline" size="sm" className="pj:text-foreground" onClick={pair.retry}>
                Try again
              </Button>
            </p>
          </AlertDescription>
        </Alert>
      )}
      {subject && (
        <ProjectionView
          subject={subject}
          projection={{
            id: document.projection.id,
            title: document.projection.title,
            renderer: typeof document.projection.renderer === 'string' ? document.projection.renderer : document.projection.renderer.bundle,
          }}
          renderer={resolution.renderer}
          rendererNotice={resolution.notice}
          {...(subject.mode === 'comparison'
            ? {beforeLabel: pair.subjectLabels.before ?? 'Before', afterLabel: pair.subjectLabels.after ?? 'After'}
            : {})}
          colorMode={colorMode}
          {...(props.themeTokens ? {themeTokens: props.themeTokens} : {})}
          {...(props.durationMs ? {durationMs: props.durationMs} : {})}
          {...(props.diagnostics ? {diagnostics: props.diagnostics} : {})}
          {...(props.notices ? {notices: props.notices} : {})}
          {...(props.onOpen ? {onOpen: props.onOpen} : {})}
          {...(props.onSelectionChange ? {onSelectionChange: props.onSelectionChange} : {})}
          {...(props.onProgressChange ? {onProgressChange: props.onProgressChange} : {})}
          {...(props.progress !== undefined ? {progress: props.progress} : {})}
          {...(props.playing !== undefined ? {playing: props.playing} : {})}
          {...(props.onPlayingChange ? {onPlayingChange: props.onPlayingChange} : {})}
          {...(props.loop !== undefined ? {loop: props.loop} : {})}
          {...(props.initialLoop !== undefined ? {initialLoop: props.initialLoop} : {})}
          {...(props.onLoopChange ? {onLoopChange: props.onLoopChange} : {})}
          {...(props.initialHolds ? {initialHolds: props.initialHolds} : {})}
          {...(props.connector !== undefined ? {connector: props.connector} : {})}
          {...(props.initialConnector !== undefined ? {initialConnector: props.initialConnector} : {})}
          {...(props.onConnectorChange ? {onConnectorChange: props.onConnectorChange} : {})}
          renderers={pair.renderers}
          presentation={pair.presentation}
          {...settings}
          toolbarStart={picker}
          fill={fill}
          {...(comparator ? {comparator} : {})}
          {...(props.features ? {features: props.features} : {})}
          {...(props.actions ? {actions: props.actions} : {})}
          {...(props.controlValues ? {controlValues: props.controlValues} : {})}
          {...(props.onControlChange ? {onControlChange: props.onControlChange} : {})}
          {...(props.onAction ? {onAction: props.onAction} : {})}
          {...(props.annotations ? {annotations: props.annotations} : {})}
          {...(props.onAnnotationActivate ? {onAnnotationActivate: props.onAnnotationActivate} : {})}
          {...(props.renderDetails ? {renderDetails: props.renderDetails} : {})}
          {...(props.details ? {details: props.details} : {})}
          {...(props.evidenceLink ? {evidenceLink: props.evidenceLink} : {})}
          {...(props.controllerRef ? {controllerRef: props.controllerRef} : {})}
          {...((props.mode ?? mode) ? {mode: (props.mode ?? mode)!} : {})}
          onModeChange={changeMode}
          swipePosition={props.swipePosition ?? swipe}
          onSwipePositionChange={changeSwipe}
          {...(props.initialView ? {initialView: props.initialView} : {})}
        />
      )}
    </ScopedRoot>
  )
}
