import type {AnnotationTone} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row, ViewSubject} from '../model.js'
import {resolveTarget, type TargetAnnotation} from './target.js'

/**
 * Combines target annotations into one marker per presented row, and lists
 * the annotations whose targets the subject doesn't present.
 */
export function placeAnnotations(
  subject: ViewSubject,
  rows: readonly Row[],
  annotations: readonly TargetAnnotation[],
): {
  marks: {id: string; count?: number; label?: string; tone?: AnnotationTone}[]
  byRow: Map<string, TargetAnnotation[]>
  unplaced: TargetAnnotation[]
} {
  const byRow = new Map<string, TargetAnnotation[]>()
  const unplaced: TargetAnnotation[] = []
  for (const annotation of annotations) {
    const resolution = resolveTarget(subject, rows, annotation.target)
    const rowId = resolution.status === 'present' ? resolution.rowId : resolution.rowId
    if (rowId === undefined) {
      unplaced.push(annotation)
      continue
    }
    byRow.set(rowId, [...(byRow.get(rowId) ?? []), annotation])
  }
  const marks = [...byRow].map(([id, list]) => {
    const counted = list.filter(item => item.count !== undefined)
    const count = counted.length ? counted.reduce((sum, item) => sum + item.count!, 0) : undefined
    const tone: AnnotationTone | undefined = list.some(item => item.tone === 'attention')
      ? 'attention'
      : list.every(item => item.tone === 'done')
        ? 'done'
        : list.every(item => item.tone === 'subtle')
          ? 'subtle'
          : list.some(item => item.tone)
            ? 'neutral'
            : undefined
    const label = list.length === 1 ? list[0]!.label : undefined
    return {id, ...(count === undefined ? {} : {count}), ...(label === undefined ? {} : {label}), ...(tone === undefined ? {} : {tone})}
  })
  return {marks, byRow, unplaced}
}
