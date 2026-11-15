import type {ReactNode, RefObject} from 'react'
import type {EvidenceLink} from '../../details/evidence.js'
import type {ProjectionController} from '../../projection.js'
import type {ProjectionSelection} from '../../targets/target.js'

/** The props of `DetailCard`: the controller whose selection it describes, where it sits and where evidence links. */
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
  /** Embedder content at the end of the card (`.ph-details-slot`). */
  renderDetails?: ((selection: ProjectionSelection, projection: ProjectionController) => ReactNode) | undefined
  /** Annotation markers on the item and its fields (default true). */
  annotations?: boolean
  /** Containers narrower than this show the card as a bottom sheet (default 640). */
  sheetBelow?: number
}
