import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'

/** The depth limit: deeper folders are drawn as one circle. Its range and default follow the document (see `depthControl`). */
export function depthControl(depth: number): RendererControl {
  const deepest = Math.max(2, Math.min(32, depth))
  return {
    id: 'maxDepth',
    label: 'Depth',
    description: 'Deepest folder level drawn; deeper folders are drawn as one circle',
    type: 'range',
    min: 1,
    max: deepest,
    step: 1,
    default: deepest,
    group: 'packing',
    groupLabel: 'Packing',
  }
}

export const measureControl: RendererControl = {
  id: 'measure',
  label: 'Size by',
  description: 'Size each file by its bytes or by its lines',
  type: 'choice',
  group: 'packing',
  groupLabel: 'Packing',
  default: 'bytes',
  choices: [
    {value: 'bytes', label: 'Bytes'},
    {value: 'lines', label: 'Lines'},
  ],
}

export const exclusionControls: RendererControl[] = [
  {
    id: 'hideDependencies',
    label: 'Hide dependencies and build output',
    description: 'Skip node_modules, dist, build, target and similar folders',
    type: 'toggle',
    group: 'exclude',
    groupLabel: 'Exclude',
    default: false,
  },
  {
    id: 'hideLockfiles',
    label: 'Hide lockfiles',
    description: 'Skip package-lock.json, Cargo.lock, go.sum and other lockfiles',
    type: 'toggle',
    group: 'exclude',
    groupLabel: 'Exclude',
    default: false,
  },
]

/** Most top-level folders offered as their own show/hide control. */
const folderControlLimit = 24

/** One show/hide control per top-level folder, with IDs a definition's `rendererOptions` can preset (`show.docs`). */
export function folderControls(names: readonly string[]): {controls: RendererControl[]; ids: Map<string, string>} {
  const ids = new Map<string, string>()
  const used = new Set<string>()
  const controls: RendererControl[] = []
  if (names.length < 2) return {controls, ids}
  for (const name of names.slice(0, folderControlLimit)) {
    const slug =
      name
        .replace(/^\.+/u, '')
        .replaceAll(/[^\w.-]/gu, '-')
        .slice(0, 50) || 'folder'
    let id = `show.${slug}`
    for (let suffix = 2; used.has(id); suffix++) id = `show.${slug}-${suffix}`
    used.add(id)
    ids.set(name, id)
    controls.push({
      id,
      label: `${name}/`,
      description: `Show ${name}/`,
      type: 'toggle',
      group: 'folders',
      groupLabel: 'Folders',
      default: true,
    })
  }
  return {controls, ids}
}
