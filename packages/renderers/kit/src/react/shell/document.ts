// The document a kit renderer presents and where its transition stands: the comparison model, the step schedule and
// each change's emphasis.
import {useEffect, useMemo, useState} from 'react'
import type {InitPayload, ProgressPayload} from '@githubnext/projections-renderer-sdk/protocol'
import {isDiff} from '@githubnext/projections-renderer-sdk/react'
import {stepEmphasis, type EmphasisOf} from '../../emphasis.js'
import {createModel, type ComparisonModel} from '../../model.js'
import {DirectionLatch, scheduleSteps, stepEnds, timelineSlots, type ScheduledStep} from '../../timeline.js'

/** A document's comparison model (or why it couldn't be built), with its own direction latch (see `DirectionLatch`). */
export interface DocumentModel {
  init: InitPayload
  model: ComparisonModel | Error
  latch: DirectionLatch
}

/** The model of the host's current document, built once per document; undefined until the host sends one. */
export function useDocumentModel(init: InitPayload | undefined): DocumentModel | undefined {
  const [model, setModel] = useState<DocumentModel>()
  if (init && model?.init !== init) {
    let next: ComparisonModel | Error
    try {
      next = createModel(init)
    } catch (error) {
      next = error instanceof Error ? error : new Error(String(error))
    }
    setModel({init, model: next, latch: new DirectionLatch()})
  }
  return model
}

const extractionProgress = {progress: 1, highlighting: 0, direction: 1 as const}

export interface Timeline {
  comparing: boolean
  diff: boolean
  /** Where the transition stands: the host's, fixed at the end in diff mode and for an extraction. */
  position: ProgressPayload
  schedule: ScheduledStep[]
  highlighting: number
  pane: 'before' | 'after' | undefined
  emphasis: EmphasisOf
}

/**
 * Where the document's transition stands, its steps for the direction it is presented in, and each change's emphasis.
 * With `automatic` steps, reports the end of each scheduled step to the host.
 */
export function useTimeline(
  init: InitPayload | undefined,
  model: DocumentModel | undefined,
  host: {progress: ProgressPayload; pane: 'before' | 'after' | undefined},
  automatic: boolean,
  reportSteps: (ends: readonly number[], slots?: number) => void,
): Timeline {
  const comparing = init?.mode === 'comparison'
  const diff = isDiff(init)
  const position = comparing ? (diff ? {...host.progress, progress: 1, direction: 1 as const} : host.progress) : extractionProgress
  const direction = model ? model.latch.update(position.progress, position.direction) : position.direction
  const resolved = model && !(model.model instanceof Error) ? model.model : undefined
  // Diff mode has no timeline: one static comparison, every change emphasized at once.
  const schedule = useMemo(
    () => (resolved && comparing && !diff ? scheduleSteps(resolved, direction) : []),
    [resolved, comparing, diff, direction],
  )
  const highlighting = comparing ? position.highlighting : 0
  const pane = host.pane
  const emphasis = useMemo(
    () => stepEmphasis(schedule, position.progress, highlighting, pane),
    [schedule, position.progress, highlighting, pane],
  )
  useEffect(() => {
    if (automatic && resolved) reportSteps(comparing ? stepEnds(schedule, direction) : [], comparing ? timelineSlots(schedule) : undefined)
  }, [automatic, resolved, comparing, schedule, direction, reportSteps])
  return {comparing, diff, position, schedule, highlighting, pane, emphasis}
}
