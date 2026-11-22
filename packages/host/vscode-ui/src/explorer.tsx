import {ComparisonError, useComparisonPair, useComparisonSession, type ComparisonPairOptions} from '@githubnext/projections-host'
import {PairPicker, type PairForm} from './blocks.js'
import {LoadingStatus} from './loading.js'
import {Notice} from './notice.js'
import {VscodeProjectionView} from './view.js'
import type {VscodeProjectionViewProps} from './view/props.js'

/**
 * The props of `VscodeComparisonExplorer`: the extractions to pair and their controlled pair (`ComparisonPairOptions`),
 * and the view props it passes through to `VscodeProjectionView`.
 */
export interface VscodeComparisonExplorerProps
  extends
    ComparisonPairOptions,
    Pick<
      VscodeProjectionViewProps,
      | 'colorMode'
      | 'themeTokens'
      | 'durationMs'
      | 'diagnostics'
      | 'notices'
      | 'onOpen'
      | 'onSelectionChange'
      | 'onProgressChange'
      | 'initialView'
      | 'playbackInViews'
      | 'progress'
      | 'playing'
      | 'onPlayingChange'
      | 'mode'
      | 'initialMode'
      | 'onModeChange'
      | 'swipePosition'
      | 'onSwipePositionChange'
      | 'highlighting'
      | 'onHighlightingChange'
      | 'changesOnly'
      | 'onChangesOnlyChange'
      | 'search'
      | 'onSearchChange'
      | 'controlValues'
      | 'onControlChange'
      | 'onAction'
      | 'actions'
      | 'features'
      | 'className'
      | 'annotations'
      | 'onAnnotationActivate'
      | 'renderDetails'
      | 'details'
      | 'evidenceLink'
      | 'controllerRef'
      | 'connector'
      | 'initialConnector'
      | 'onConnectorChange'
      | 'loop'
      | 'initialLoop'
      | 'onLoopChange'
      | 'initialHolds'
      | 'fill'
      | 'toolbar'
    > {
  /** The scope the explorer starts in: the definition's `presentation.changesOnly`, else Changes (`useComparisonSession`). */
  initialChangesOnly?: boolean
}

/**
 * The VS Code pair picker: choose any two extractions of a projection and see
 * their comparison, computed in the browser with the projection's comparator
 * (`useComparisonPair`), in `VscodeProjectionView`. Choosing no base shows
 * one extraction. Mode, divider, highlighting, "changes only" and find persist
 * across pairs. The pair is controllable with `before`/`after` and
 * `onBeforeChange`/`onAfterChange` (`ComparisonPairOptions`).
 */
export function VscodeComparisonExplorer(props: VscodeComparisonExplorerProps) {
  const pair = useComparisonPair(props)
  // The view remounts while a new pair is computed, so the session above it keeps the settings across pairs.
  const session = useComparisonSession({...props, presentation: pair.presentation})
  const {extractions, before, after, outcome, subject, document, resolution} = pair
  if (!after || !document) {
    return (
      <div className="phv-explorer">
        <Notice title="No extractions">No extractions are available for this projection.</Notice>
      </div>
    )
  }
  const comparator = outcome.status === 'compared' ? outcome.result.comparator : undefined
  const renderer = document.projection.renderer
  const picker = (_compact: boolean, form: PairForm) => <PairPicker pair={pair} form={form} />
  const fill = props.fill !== false
  return (
    <div className={`ph-explorer phv-explorer ${props.className ?? ''}`} data-outcome={outcome.status} data-fill={fill || undefined}>
      {!subject && props.toolbar !== false && (
        <div className="phv-toolbar-wrap">
          <div className="phv-toolbar">
            <div className="phv-toolbar-start">{picker(false, 'full')}</div>
          </div>
        </div>
      )}
      {outcome.status === 'computing' && (
        <LoadingStatus className="ph-computing" label="Computing the comparison in this browser…" fill={fill} />
      )}
      {outcome.status === 'failed' && (
        <div role="alert" className="phv-failure" data-error-code={outcome.error instanceof ComparisonError ? outcome.error.code : 'error'}>
          <Notice
            severity="error"
            title="These extractions can't be compared."
            actions={[
              {label: `Show ${after.label} on its own`, onClick: () => pair.setBefore('')},
              {label: 'Try again', onClick: pair.retry, secondary: true},
            ]}
          >
            {outcome.error.message}
            {outcome.error instanceof ComparisonError && outcome.error.details.length > 0 && (
              <ul className="phv-list">
                {outcome.error.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}
      {subject && (
        <VscodeProjectionView
          subject={subject}
          projection={{
            id: document.projection.id,
            title: document.projection.title,
            renderer: typeof renderer === 'string' ? renderer : renderer.bundle,
          }}
          renderer={resolution.renderer}
          rendererNotice={resolution.notice}
          toolbarStart={picker}
          comparator={comparator}
          {...(subject.mode === 'comparison'
            ? {beforeLabel: pair.subjectLabels.before ?? 'Before', afterLabel: pair.subjectLabels.after ?? 'After'}
            : {})}
          {...(props.colorMode ? {colorMode: props.colorMode} : {})}
          {...(props.themeTokens ? {themeTokens: props.themeTokens} : {})}
          {...(props.durationMs ? {durationMs: props.durationMs} : {})}
          {...(props.diagnostics ? {diagnostics: props.diagnostics} : {})}
          {...(props.notices ? {notices: props.notices} : {})}
          {...(props.features ? {features: props.features} : {})}
          {...(props.actions ? {actions: props.actions} : {})}
          {...(props.onOpen ? {onOpen: props.onOpen} : {})}
          {...(props.onSelectionChange ? {onSelectionChange: props.onSelectionChange} : {})}
          {...(props.onProgressChange ? {onProgressChange: props.onProgressChange} : {})}
          {...(props.progress !== undefined ? {progress: props.progress} : {})}
          {...(props.playing !== undefined ? {playing: props.playing} : {})}
          {...(props.onPlayingChange ? {onPlayingChange: props.onPlayingChange} : {})}
          renderers={pair.renderers}
          rendererDocuments={pair.rendererDocuments}
          presentation={pair.presentation}
          {...session}
          {...(props.controlValues ? {controlValues: props.controlValues} : {})}
          {...(props.onControlChange ? {onControlChange: props.onControlChange} : {})}
          {...(props.onAction ? {onAction: props.onAction} : {})}
          {...(props.annotations ? {annotations: props.annotations} : {})}
          {...(props.onAnnotationActivate ? {onAnnotationActivate: props.onAnnotationActivate} : {})}
          {...(props.renderDetails ? {renderDetails: props.renderDetails} : {})}
          {...(props.details ? {details: props.details} : {})}
          {...(props.evidenceLink ? {evidenceLink: props.evidenceLink} : {})}
          {...(props.controllerRef ? {controllerRef: props.controllerRef} : {})}
          fill={fill}
          {...(props.toolbar === false ? {toolbar: false} : {})}
          {...(props.initialHolds ? {initialHolds: props.initialHolds} : {})}
          {...(props.initialView ? {initialView: props.initialView} : {})}
          {...(props.playbackInViews ? {playbackInViews: props.playbackInViews} : {})}
        />
      )}
    </div>
  )
}
