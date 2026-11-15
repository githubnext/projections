import type {RendererFrameEvent} from '@githubnext/projections-host'
import type {StageState} from '@githubnext/projections-renderer-testing'

/** A renderer event that only records something in the stage's state. */
export type RecordedEvent = Exclude<RendererFrameEvent, {type: 'ready' | 'rendered' | 'failed'}>

/** Records what a renderer reported: its selection, steps, controls, legend, summary, height, opened files and errors. */
export function recordEvent(state: StageState, event: RecordedEvent): void {
  switch (event.type) {
    case 'select':
      state.selection = event.id
      state.selections.push(event.id)
      break
    case 'steps':
      state.steps = event.ends
      break
    case 'controls':
      state.controls = event.controls
      break
    case 'legend': {
      const {type: _type, ...legend} = event
      if (legend.items.length) state.legend = legend
      else delete state.legend
      break
    }
    case 'summary':
      if (event.items.length) state.summary = event.items
      else delete state.summary
      break
    case 'height':
      state.height = event.px
      break
    case 'open':
      state.opened.push(event.line === undefined ? {path: event.path} : {path: event.path, line: event.line})
      break
    case 'error':
      state.errors.push(event.message)
      break
    case 'rejected':
      state.rejected.push(event.reason)
      break
  }
}
