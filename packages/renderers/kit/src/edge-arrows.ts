// Card-to-card arrows for renderers that place cards themselves (dependency injection);
// graph layouts route their relationships with ELK (see layout/routing.ts).
import {arrowHeadLength} from './arrowhead.js'

/** The arrowhead's length from tip to base (see `arrowHeadLength`); paths from `boxEdge` end this far short of the card. */
export const edgeArrowHeadLength = arrowHeadLength

/** A card's box for routing arrows, in drawing units with y growing downward: its top-left corner and size. */
export interface ArrowBox {
  /** The box's left side. */
  x: number
  /** The box's top side. */
  y: number
  /** The box's width; not negative. */
  width: number
  /** The box's height; not negative. */
  height: number
}

/** A point or a vector in drawing units, with y growing downward. */
export interface Point {
  /** Distance rightward. */
  x: number
  /** Distance downward. */
  y: number
}
