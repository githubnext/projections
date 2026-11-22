import type {ReactNode} from 'react'
import type {ProjectionController} from '../../projection.js'
import {
  FilterButton,
  MoreMenu,
  MoreSection,
  PlaybackExtras,
  RegeneratedToggle,
  VariedToggle,
  ZoomControls,
  type ViewKind,
} from '../blocks.js'
import {cn} from '../lib/utils.js'

/**
 * The toolbar's More menu: the blocks the plan moved out of the row (playback's steps and percent, the variation
 * toggles, zoom and the filter field) as sections, then About this projection and full screen, ruled off from them.
 */
export function ToolbarMore({
  projection: p,
  view,
  playback,
  varied,
  zoom,
  filter,
  info,
  fullscreen,
}: {
  projection: ProjectionController
  view: ViewKind
  playback: boolean
  varied: boolean
  zoom: boolean
  filter: boolean
  /** About this projection's button, when it moved into More. */
  info: ReactNode
  /** The full screen button, when it moved into More. */
  fullscreen: ReactNode
}) {
  return (
    <MoreMenu>
      {playback && (
        <MoreSection label="Playback">
          <PlaybackExtras projection={p} always={view !== 'renderer'} position />
        </MoreSection>
      )}
      {varied && (
        <MoreSection label="Variation">
          <RegeneratedToggle projection={p} inline />
          <VariedToggle projection={p} inline />
        </MoreSection>
      )}
      {zoom && (
        <MoreSection label="Zoom">
          <ZoomControls projection={p} />
        </MoreSection>
      )}
      {filter && (
        <MoreSection label="Filter">
          <FilterButton projection={p} inline />
        </MoreSection>
      )}
      {(Boolean(info) || Boolean(fullscreen)) && (
        <div className={cn('pj:flex pj:items-center pj:gap-0.5', (varied || zoom || filter || playback) && 'pj:border-t pj:pt-2')}>
          {info}
          {fullscreen}
        </div>
      ) : null}
    </MoreMenu>
  )
}
