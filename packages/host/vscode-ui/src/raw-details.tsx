import type {ReactNode} from 'react'
import type {ProjectionController, ProjectionSelection} from '@githubnext/projections-host'
import {VscodeDetails} from './views/details.js'

/**
 * The selected item's raw details (`VscodeDetails`) for a docked panel, with the consumer slot `renderDetails` below
 * the properties (`.ph-details-slot`). Renders nothing while nothing is selected. The views show the `DetailCard`
 * instead.
 */
export function RawDetails({
  projection: p,
  onOpen,
  renderDetails,
  beforeLabel = 'Before',
  afterLabel = 'After',
  annotations = true,
}: {
  projection: ProjectionController
  onOpen?: ((path: string, line?: number) => void) | undefined
  renderDetails?: ((selection: ProjectionSelection, projection: ProjectionController) => ReactNode) | undefined
  beforeLabel?: string
  afterLabel?: string
  /** Annotation markers in the panel (default true). */
  annotations?: boolean
}) {
  const row = p.selectedRow
  if (!row) return null
  const mark = p.annotationMarks.find(item => item.id === row.id)
  return (
    <VscodeDetails
      subject={p.subject}
      row={row}
      close={() => p.select(null)}
      onOpen={onOpen}
      beforeLabel={beforeLabel}
      afterLabel={afterLabel}
      selection={p.selection}
      onSelectTarget={target => {
        p.selectTarget(target)
      }}
      {...(annotations ? {mark, annotations: p.annotationsFor(row.id), onAnnotationActivate: p.activateAnnotation} : {})}
    >
      {p.selection && renderDetails?.(p.selection, p)}
    </VscodeDetails>
  )
}
