import type {CSSProperties, ReactNode} from 'react'
import type {AnnotationMark} from '@githubnext/projections-renderer-sdk/protocol'
import type {ProjectionController} from '../../projection.js'
import {UtilityArea, utilityInset} from '../../stage/utility.js'
import {StageFoot, scopeNoticeText, summaryFootHeight} from './stage-foot.js'
import {cn} from '../lib/utils.js'
import {TableView, TextView} from '../views.js'

/**
 * The default view's own table or text view, scrolling in the panel, with the floating playback over it (`floating`,
 * see `useUtilityPlayback`) and its top padded clear of it (`scrollTop`), when the view has a utility area, and the
 * summary floating at its foot (`StageFoot`), its end padded clear of that.
 */
export function HostViews({
  projection: p,
  view,
  fill,
  marks,
  summary,
  scope,
  floating,
  scrollTop,
}: {
  projection: ProjectionController
  view: 'table' | 'text'
  fill: boolean
  marks: ReadonlyMap<string, AnnotationMark>
  summary: boolean
  /** Without the summary, the foot says what the Changes scope hides (`StageFoot`'s `scope`). */
  scope: boolean
  floating: ReactNode
  scrollTop: CSSProperties | undefined
}) {
  const {subject} = p
  const footed = summary || (scope && Boolean(scopeNoticeText(p)))
  return (
    <>
      {Boolean(floating) && <UtilityArea>{floating}</UtilityArea>}
      <div
        className={cn('ph-scroll pj:min-w-0 pj:bg-surface-canvas pj:p-3', fill && 'pj:min-h-0 pj:flex-1 pj:overflow-auto')}
        style={footed ? {...scrollTop, paddingBottom: utilityInset + summaryFootHeight + 12} : scrollTop}
      >
        {view === 'table' ? (
          <TableView
            subject={subject}
            rows={p.visibleRows}
            total={p.rows.length}
            progress={p.progress}
            selectedId={p.selectedId}
            onSelect={p.select}
            annotations={marks}
            onAnnotationActivate={p.activateAnnotation}
          />
        ) : (
          <TextView
            subject={subject}
            rows={p.visibleRows}
            progress={p.progress}
            selectedId={p.selectedId}
            onSelect={p.select}
            annotations={marks}
            onAnnotationActivate={p.activateAnnotation}
            summary={summary ? p.summary : undefined}
          />
        )}
      </div>
      <StageFoot projection={p} summary={summary} legend={false} scope={scope} />
    </>
  )
}
