import type {InspectorRendererList} from '../types.js'
import {record} from './guards.js'

/** Validates a `GET /api/renderers` response; the custom renderer base must be a same-origin path. */
export function parseRendererList(value: unknown, origin: string): InspectorRendererList {
  // The runner lists `renderer.json` manifests; only their names are used here.
  const names = record(value) && Array.isArray(value.renderers) ? value.renderers.map(item => (record(item) ? item.name : item)) : undefined
  if (
    !record(value) ||
    !names ||
    names.length > 100 ||
    names.some(name => typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) ||
    Object.keys(value).some(key => key !== 'renderers' && key !== 'customRendererBase')
  ) {
    throw new Error('The local runner returned an invalid renderer list')
  }
  const list: InspectorRendererList = {renderers: names as string[]}
  if (value.customRendererBase !== undefined) {
    if (typeof value.customRendererBase !== 'string' || value.customRendererBase.length > 1024)
      throw new Error('The local runner returned an invalid custom renderer base')
    const base = new URL(value.customRendererBase, origin)
    if (base.origin !== new URL(origin).origin || base.search || base.hash || !base.pathname.endsWith('/')) {
      throw new Error('The custom renderer base must be a same-origin directory')
    }
    list.customRendererBase = base.href
  }
  return list
}
