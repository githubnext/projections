import {useId} from 'react'
import {X} from 'lucide-react'
import {rowDetails} from '../details.js'
import {useDetailCard} from '../detail-card.js'
import {AnnotationMarker} from './annotations.js'
import {Button} from './components/button.js'
import {cn} from './lib/utils.js'
import type {DetailCardProps} from './detail-card/props.js'
import {ChangesSection, ConnectionsSection, EvidenceSection, section} from './detail-card/sections.js'

/**
 * The detail card for the selection, anchored to the selected item over the stage (`useDetailCard`): what changed,
 * field by field, with the comparator's classification; where in the code, as links (`evidenceLink`) or open
 * requests (`onOpen`); and the item's connections, each selecting its item. Nothing moves when it opens. Escape, "Close
 * details" or a press outside close it; a new selection opens it again. Renders nothing while closed.
 */
export function DetailCard({
  projection: p,
  container,
  view,
  onOpen,
  evidenceLink,
  beforeLabel = 'Before',
  renderDetails,
  annotations = true,
  sheetBelow,
}: DetailCardProps) {
  const {row, placement, style, ref, close, select} = useDetailCard(p, {container, view, ...(sheetBelow === undefined ? {} : {sheetBelow})})
  const id = useId()
  if (!row) return null
  const details = rowDetails(p.subject, row, p.rows)
  const comparing = p.subject.mode === 'comparison'
  const mark = annotations ? p.annotationMarks.find(item => item.id === row.id) : undefined
  const marks = annotations ? p.annotationsFor(row.id) : []
  const sheet = placement?.sheet ?? false
  const titleId = `${id}-title`
  return (
    <aside
      ref={ref}
      className={cn(
        'ph-detail-card pj:flex pj:w-80 pj:min-w-0 pj:flex-col pj:overflow-auto pj:overscroll-contain pj:border pj:border-divider pj:bg-surface-raised pj:text-sm pj:text-card-foreground pj:shadow-lg',
        sheet ? 'pj:rounded-t-lg' : 'pj:rounded-lg',
      )}
      style={style}
      aria-labelledby={titleId}
      data-detail-card={row.id}
      data-placement={placement ? (sheet ? 'sheet' : placement.side) : undefined}
    >
      <header className="ph-detail-card-header pj:sticky pj:top-0 pj:z-1 pj:flex pj:items-start pj:gap-2 pj:border-b pj:border-divider pj:bg-surface-header pj:py-1.5 pj:pr-1.5 pj:pl-3">
        <h3
          id={titleId}
          tabIndex={-1}
          data-detail-card-title=""
          className="pj:min-w-0 pj:flex-1 pj:self-center pj:break-words pj:font-semibold pj:leading-tight pj:focus-visible:outline-hidden"
        >
          {row.label}
        </h3>
        {mark && <AnnotationMarker mark={mark} rowLabel={row.label} onActivate={p.activateAnnotation} className="pj:mt-1" />}
        <Button type="button" variant="ghost" size="icon" className="pj:h-7 pj:w-7 pj:shrink-0" aria-label="Close details" onClick={close}>
          <X />
        </Button>
      </header>
      {(comparing || details.fields.length > 0) && <ChangesSection projection={p} row={row} details={details} id={id} marks={marks} />}
      {details.evidence.length > 0 && (
        <EvidenceSection
          details={details}
          id={id}
          comparing={comparing}
          onOpen={onOpen}
          evidenceLink={evidenceLink}
          beforeLabel={beforeLabel}
        />
      )}
      {details.connections.length > 0 && <ConnectionsSection details={details} id={id} onSelect={select} />}
      {renderDetails && p.selection && <div className={cn('ph-details-slot', section)}>{renderDetails(p.selection, p)}</div>}
    </aside>
  )
}
