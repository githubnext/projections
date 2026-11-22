import type {RefNames} from '../labels.js'
import {record} from './definitions.ts'
import {pairLabel, type Pair, type PairList} from './pairs.ts'

const ref = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

function pairOf(value: unknown): Pair | undefined {
  const item = record(value)
  const after = ref(item?.after)
  if (!item || !after) return undefined
  const before = ref(item.before)
  return {...(before ? {before} : {}), after}
}

/** Reads `GET /api/pairs`' body. */
export function parsePairs(body: unknown): PairList {
  const value = record(body) ?? {}
  const suggestions = (Array.isArray(value.suggestions) ? value.suggestions : []).flatMap(entry => {
    const pair = pairOf(entry)
    const item = record(entry)
    if (!pair || !item) return []
    const failed = Boolean(item.error)
    return failed
      ? []
      : [{...pair, label: ref(item.label) ?? pairLabel(pair), source: ref(item.source) ?? 'suggestion', identical: item.identical === true}]
  })
  const bookmarks = (Array.isArray(value.bookmarks) ? value.bookmarks : []).flatMap(entry => {
    const pair = pairOf(entry)
    const item = record(entry)!
    if (!pair) return []
    const projection = ref(item.projectionId) ?? ref(item.projection)
    const id = ref(item.id)
    return [
      {
        ...pair,
        label: ref(item.title) ?? id ?? pairLabel(pair),
        source: 'bookmark',
        ...(id ? {id} : {}),
        ...(projection ? {projection} : {}),
      },
    ]
  })
  const names = (list: unknown) =>
    (Array.isArray(list) ? list : []).flatMap(entry => {
      const name = ref(record(entry)?.name)
      return name ? [name] : []
    })
  const head = record(value.head)
  const named = (list: unknown) =>
    (Array.isArray(list) ? list : []).flatMap(entry => {
      const item = record(entry)
      const name = ref(item?.name)
      return name
        ? [{name, ...(ref(item!.commit) ? {commit: ref(item!.commit)!} : {}), ...(item!.current === true ? {current: true} : {})}]
        : []
    })
  const refs: RefNames = {
    branches: named(value.branches),
    tags: named(value.tags),
    ...(head
      ? {head: {...(ref(head.branch) ? {branch: ref(head.branch)!} : {}), ...(ref(head.commit) ? {commit: ref(head.commit)!} : {})}}
      : {}),
    ...(ref(value.mergeBase) ? {mergeBase: ref(value.mergeBase)!} : {}),
    ...(ref(value.defaultBranch) ? {defaultBranch: ref(value.defaultBranch)!} : {}),
  }
  return {
    refs,
    default: pairOf(value.default),
    suggestions,
    bookmarks,
    branches: names(value.branches),
    tags: names(value.tags),
    ...(head
      ? {
          head: {
            ...(ref(head.branch) ? {branch: ref(head.branch)!} : {}),
            ...(ref(head.commit) ? {commit: ref(head.commit)!} : {}),
            ...(typeof head.dirty === 'boolean' ? {dirty: head.dirty} : {}),
          },
        }
      : {}),
    ...(ref(value.defaultBranch) ? {defaultBranch: ref(value.defaultBranch)!} : {}),
  }
}
