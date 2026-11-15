import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {createStagedTimeline, statusParts, unitProgress} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, ScheduledStep, StagedTimeline} from '@githubnext/projections-renderer-kit'
import {layoutStates} from './layout.js'
import type {MeasureText, TextArea, TextChrome, TextRole} from './text.js'
import type {SchemaLayout, SchemaModel} from './schema.js'
import {fader, longestIncreasing} from './fading.js'
import type {FrameColumn, FrameLink, FrameTable, FrameTag, SchemaFrame} from './frame.js'
import {selfLoopRoom, stageLinkShapes} from './links.js'
import {fades, stagedModels, tagOrder} from './stages.js'
import {frameTables, frameTags} from './interpolate.js'
import {frameLinks} from './interpolate-links.js'
import type {Placed, Staged} from './interpolate.js'

export interface DatabaseTransition {
  (progress: number): SchemaFrame
  timeline: StagedTimeline
  models: SchemaModel[]
  layouts: SchemaLayout[]
  /** Tag rows (keys, indexes, other entities) in presentation order for each stage. */
  tagStages: {id: string; label: string}[][]
  /** Every tag row any stage shows, in presentation order. */
  tags: EntityChange<Entity>[]
  /** Lines a card draws text in (see text.ts): the lines its header and row heights were counted for. */
  lines: (role: TextRole, text: string, fits: boolean, area?: TextArea) => string[]
}

export interface DatabaseTransitionOptions {
  /** Width available to the canvas, in CSS pixels. */
  available: number
  /** Draw foreign-key links (default true). When false, no gutter is reserved for them. */
  links?: boolean
  /** Measures text in the fonts it's drawn with (the view passes canvas measurements); estimated when absent. */
  measure?: MeasureText
  /** Widths that aren't text, read from the styles; the defaults match styles.css. */
  chrome?: TextChrome
}

/**
 * The database view as a pure function of progress, driven by the
 * comparison's steps. Each stage (the state before the first step and after
 * each step) is laid out with one shared card width and layout mode; a frame
 * interpolates between two adjacent stages during one step's move window, so
 * leaving tables, columns, links and tags fade before the layout closes their
 * gap, and arrivals fade in only after it has made room.
 */
export function createDatabaseTransition(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  options: DatabaseTransitionOptions,
): DatabaseTransition {
  const showLinks = options.links ?? true
  const timeline = createStagedTimeline(model, schedule)
  const {rows, states, models, owner} = stagedModels(model, timeline)
  const layouts = layoutStates(models, options.available, showLinks, options.measure, options.chrome, card => ({
    status: rows.has(card) ? statusParts(rows.get(card)!).map(part => part.label) : [],
  }))
  const last = layouts.length - 1
  const windows = timeline.windows
  const mode = layouts[last]!.mode
  const faded = fades(models, layouts, windows, showLinks)
  const shapes = stageLinkShapes(models, layouts, showLinks)
  const {tagStages, tagIds} = tagOrder(states, models)
  const tagFade = new Map(
    tagIds.map(id => [
      id,
      fader(
        models.map(stage => stage.others.includes(id)),
        windows,
      ),
    ]),
  )
  const staged: Staged = {...faded, timeline, rows, states, models, layouts, owner, last, mode, shapes, tagIds, tagFade}

  const selfLinks = faded.linkKeys.some(key => {
    const link = models.map(stage => stage.links.find(item => item.key === key)).find(Boolean)!
    return link.dependent === link.principal
  })
  const width = Math.max(...layouts.map(layout => layout.width)) + (selfLinks && mode === 'columns' ? selfLoopRoom : 0)
  const height = Math.max(...layouts.map(layout => layout.height))

  const transition = ((progress: number): SchemaFrame => {
    const t = unitProgress(progress)
    const stage = timeline.at(t)
    const placed: Placed = {boxes: new Map(), tops: new Map(), headers: new Map(), columnOpacity: new Map()}
    const tables = frameTables(staged, t, stage, placed)
    const links = frameLinks(staged, t, stage, tables, placed)
    const tags = frameTags(staged, t, stage)
    return {mode, width, height, tables, links, tags, stage}
  }) as DatabaseTransition
  transition.timeline = timeline
  transition.models = models
  transition.layouts = layouts
  transition.tagStages = tagStages
  transition.tags = tagIds.map(id => rows.get(id)!)
  const cardWidth = layouts[last]!.cardWidth
  transition.lines = (role, text, fits, area) => layouts[last]!.sizer.lines(role, text, cardWidth, fits, area)
  return transition
}
