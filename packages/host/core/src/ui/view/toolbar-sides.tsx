import type {KeyboardEventHandler, ReactNode, RefObject} from 'react'
import {Toolbar, ToolbarRow} from '../toolbar.js'
import type {ProjectionViewProps} from './props.js'

/** Whether the view's toolbar takes the sides layout (`ToolbarContent.sides`): with a utility area, playback being on the stage. */
export const sidesOf = (props: ProjectionViewProps): boolean => props.utilityArea === true

/**
 * The default view's toolbar in the sides layout (`ToolbarContent.sides`): one row, the start content (a picker) and
 * then the mode region at its start, the actions at its end. Playback is never here: it floats on the stage.
 */
export function SidesToolbar({
  toolbar,
  space,
  start,
  mode,
  end,
}: {
  toolbar: RefObject<HTMLDivElement | null>
  space: KeyboardEventHandler | undefined
  start: ReactNode
  mode: ReactNode
  end: ReactNode
}) {
  return (
    <Toolbar ref={toolbar} rows onKeyDown={space} className="ph-toolbar-sides">
      <ToolbarRow>
        <div data-toolbar-region="start" data-fit="row" className="ph-toolbar-start pj:flex pj:min-w-0 pj:items-center pj:gap-1.5">
          {start}
          {mode}
        </div>
        <span aria-hidden="true" data-fit-min="0" className="pj:flex-1" />
        {end}
      </ToolbarRow>
    </Toolbar>
  )
}
