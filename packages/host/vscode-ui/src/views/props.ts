// The host's built-in views in VS Code's controls: the table, the text outline, the raw details and the legend, and
// the change labels and annotation markers they share.

import type {AnnotationMark, Row, SummaryFigure, ViewSubject} from '@githubnext/projections-host'

/** The props of the built-in views, `VscodeTableView` and `VscodeTextView`: the rows to show and the selection. */
export interface VscodeBuiltInViewProps {
  subject: ViewSubject
  /** The rows to show: the host's rows after its find and "changes only" settings. */
  rows: readonly Row[]
  /** How many rows exist before filtering. */
  total?: number
  /** Comparison mode: the current presentation position (0 before, 1 after). */
  progress: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Annotation markers per row ID (`ProjectionController.annotationMarks`). */
  marks?: ReadonlyMap<string, AnnotationMark>
  /** Called when a row's marker is activated (`ProjectionController.activateAnnotation`). */
  onAnnotationActivate?: (rowId: string) => void
  /** The summary bar's figures (`ProjectionController.summary`), which the text view states in the bar's words. */
  summary?: readonly SummaryFigure[] | undefined
}
