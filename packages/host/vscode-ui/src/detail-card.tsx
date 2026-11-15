import {useId} from 'react'
import type {ReactNode, RefObject} from 'react'
import {rowDetails, useDetailCard} from '@githubnext/projections-host'
import type {EvidenceLink, ProjectionController, ProjectionSelection} from '@githubnext/projections-host'
import {AnnotationMarker} from './views/row-parts.js'
import {ActionButton} from './elements.js'
import {uiCodicons} from './codicons.js'
import {FieldRow} from './detail-card/field.js'
import {ChangesSection, ConnectionsSection, EvidenceSection} from './detail-card/sections.js'

/** The props of `DetailCard`; `beforeLabel` (default "Before") marks the before revision's evidence in a comparison. */
export interface DetailCardProps {
  projection: ProjectionController
  /**
   * The card's containing block: a positioned element (`position: relative`) around the stage and the table and text
   * views. The card overlays it and stays within its visible box; on one narrower than `sheetBelow` it is a bottom
   * sheet.
   */
  container: RefObject<HTMLElement | null>
  /** The view around the container: presses in it outside the container (the toolbar and its popovers) keep the card. */
  view?: RefObject<HTMLElement | null> | undefined
  /** Called when an evidence location is activated and `evidenceLink` gives no link for it. */
  onOpen?: ((path: string, line?: number) => void) | undefined
  /** Where to link an evidence location, for example a pull request's file diff; `undefined` falls back to `onOpen`. */
  evidenceLink?: EvidenceLink | undefined
  beforeLabel?: string
  afterLabel?: string
  /** Consumer content at the end of the card (`.ph-details-slot`). */
  renderDetails?: ((selection: ProjectionSelection, projection: ProjectionController) => ReactNode) | undefined
  /** Annotation markers on the item and its fields (default true). */
  annotations?: boolean
  /** Containers narrower than this show the card as a bottom sheet (default 640). */
  sheetBelow?: number
}

/**
 * The detail card for the selection, anchored to the selected item over the stage (`useDetailCard`), drawn as VS Code's hover widget (`--vscode-editorHoverWidget-*`): what changed,
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
  const card = useDetailCard(p, {container, view, ...(sheetBelow === undefined ? {} : {sheetBelow})})
  const id = useId()
  const row = card.row
  if (!row) return null
  const details = rowDetails(p.subject, row, p.rows)
  const comparing = p.subject.mode === 'comparison'
  const mark = annotations ? p.annotationMarks.find(item => item.id === row.id) : undefined
  const marks = annotations ? p.annotationsFor(row.id) : []
  const titleId = `${id}-title`
  return (
    <aside
      ref={card.ref}
      className="phv-detail-card"
      style={card.style}
      aria-labelledby={titleId}
      data-detail-card={row.id}
      data-placement={card.placement ? (card.placement.sheet ? 'sheet' : card.placement.side) : undefined}
    >
      <header className="phv-detail-card-header">
        <h3 id={titleId} tabIndex={-1} data-detail-card-title="" className="phv-detail-card-title">
          {row.label}
        </h3>
        {mark && <AnnotationMarker mark={mark} row={row} onActivate={p.activateAnnotation} />}
        <ActionButton icon={uiCodicons.close} label="Close details" onClick={card.close} />
      </header>
      {(comparing || details.fields.length > 0) && (
        <ChangesSection
          id={`${id}-changes`}
          details={details}
          comparing={comparing}
          field={change => <FieldRow key={change.key} change={change} projection={p} row={row} marks={marks} />}
        />
      )}
      {details.evidence.length > 0 && (
        <EvidenceSection
          id={`${id}-evidence`}
          details={details}
          comparing={comparing}
          beforeLabel={beforeLabel}
          evidenceLink={evidenceLink}
          onOpen={onOpen}
        />
      )}
      {details.connections.length > 0 && <ConnectionsSection id={`${id}-connections`} details={details} select={card.select} />}
      {renderDetails && p.selection && <div className="ph-details-slot phv-detail-section">{renderDetails(p.selection, p)}</div>}
    </aside>
  )
}
