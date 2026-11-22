import type {Marks} from './pairs.js'
import type {InspectorOpenedOn} from './props.js'

/** A projection and pair the Inspector was opened on: `initial` (a host without navigation), else the page's query. */
export function openedOn(initial?: InspectorOpenedOn): {projection?: string; pair?: Marks} {
  if (!initial && typeof location === 'undefined') return {}
  const query = initial ? undefined : new URLSearchParams(location.search)
  const projection = (initial ? initial.projection : query!.get('projection')) ?? undefined
  const after = (initial ? initial.after : query!.get('after')) ?? undefined
  const before = (initial ? initial.before : query!.get('before')) ?? undefined
  return {
    ...(projection ? {projection} : {}),
    ...(after ? {pair: {a: before, b: after}} : {}),
  }
}
export const pairKey = (repository: string, projection: string) => `projections-inspector-pair:${repository}:${projection}`
export const recentKey = (repository: string, projection: string) => `projections-inspector-pairs:${repository}:${projection}`
/** The projection last chosen in a repository, which the Inspector opens on again. */
export const currentKey = (repository: string) => `projections-inspector-projection:${repository}`
/** The JSON stored under `key`, when it is what `valid` accepts. */
export function readJson<T>(key: string, valid: (value: unknown) => value is T): T | undefined {
  try {
    const text = localStorage.getItem(key)
    if (text === null) return undefined
    const value: unknown = JSON.parse(text)
    return valid(value) ? value : undefined
  } catch {
    return undefined
  }
}
export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable */
  }
}
