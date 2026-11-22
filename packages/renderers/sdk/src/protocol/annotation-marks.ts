// The markers a host's `annotations` message asks a renderer to draw.
import {rendererLimits} from './frame.js'
import {annotationTones, type AnnotationMark, type AnnotationTone, type HostMessage} from './messages.js'
import {keys, record, text} from './validation.js'

type Fields = Record<string, unknown>

/** Validates one annotation mark: an item's ID, and an optional count, label and tone within their limits. */
function annotationMark(item: unknown): AnnotationMark | undefined {
  if (!record(item) || !keys(item, ['id', 'count', 'label', 'tone']) || !text(item.id) || !item.id) return undefined
  const {count, label, tone} = item
  if (
    count !== undefined &&
    !(Number.isSafeInteger(count) && (count as number) >= 0 && (count as number) <= rendererLimits.annotationCount)
  ) {
    return undefined
  }
  if (label !== undefined && !(typeof label === 'string' && label.length <= rendererLimits.annotationLabel)) return undefined
  if (tone !== undefined && !annotationTones.includes(tone as AnnotationTone)) return undefined
  return {
    id: item.id,
    ...(count === undefined ? {} : {count: count as number}),
    ...(label === undefined ? {} : {label: label as string}),
    ...(tone === undefined ? {} : {tone: tone as AnnotationTone}),
  }
}

/** Validates an `annotations` message's marks. */
export function parseAnnotations(message: Fields): HostMessage | undefined {
  const {items} = message
  if (!Array.isArray(items) || items.length > rendererLimits.annotations) return undefined
  const parsed: AnnotationMark[] = []
  for (const item of items) {
    const mark = annotationMark(item)
    if (!mark) return undefined
    parsed.push(mark)
  }
  return {type: 'annotations', items: parsed}
}
