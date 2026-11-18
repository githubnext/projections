import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {Side} from './model.js'

/** What every part of a frame reads: the host's props, the revision shown and how strongly a change shows. */
export interface Frame {
  props: RendererProps
  side: Side
  comparing: boolean
  /** A change's emphasis in this frame: 0 at the endpoints, with highlighting off, and for unchanged items. */
  strength: (row: EntityChange<Entity>) => number
}
