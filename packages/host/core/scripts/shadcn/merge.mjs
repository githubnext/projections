// Three-way merge of a vendored component: our file against the transformed old and new upstream items.
import {spawnSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseHeader} from './header.mjs'
import {itemSource, transformItem} from './transform.mjs'

/** Sets the header's release (`shadcn@x.y.z`) without touching anything else. */
export function withVersion(source, version) {
  return source.replace(/^(\/\/ Adapted from shadcn\/ui \(https:\/\/ui\.shadcn\.com\), style [\w-]+, shadcn@)[\w.+-]+\./m, `$1${version}.`)
}

/** Runs `git merge-file` (diff3 conflict style) and returns the merged text and the number of conflicts. */
export async function mergeFile({ours, base, theirs}, labels) {
  const directory = await mkdtemp(join(tmpdir(), 'shadcn-merge-'))
  try {
    const paths = ['ours', 'base', 'theirs'].map(name => join(directory, `${name}.tsx`))
    await Promise.all([ours, base, theirs].map((text, index) => writeFile(paths[index], text)))
    const result = spawnSync('git', ['merge-file', '-p', '--diff3', ...labels.flatMap(label => ['-L', label]), ...paths], {
      encoding: 'utf8',
    })
    if (result.error) throw result.error
    if (result.status < 0 || result.status > 127) throw new Error(`git merge-file failed: ${result.stderr}`)
    return {text: result.stdout, conflicts: result.status}
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}

/**
 * Brings one component to the new upstream item. Both items are transformed with our file's header notes and the new
 * version, and our header is bumped first, so the header never conflicts and only upstream's and our real edits meet.
 * Without a base or a file of ours, the component is new and is the transformed item.
 */
export async function mergeComponent({name, ours, baseItem, nextItem, style, version}) {
  if (ours == null) {
    if (baseItem) throw new Error(`${name}: upstream/${name}.json exists but ${name}.tsx doesn't`)
    return {status: 'added', text: await transformItem(nextItem, {style, version}), conflicts: 0}
  }
  if (!baseItem) throw new Error(`${name}: ${name}.tsx has no pristine base (upstream/${name}.json)`)
  const parsed = parseHeader(ours)
  if (!parsed) throw new Error(`${name}: ${name}.tsx has no "Adapted from shadcn/ui" header`)
  const bumped = withVersion(ours, version)
  if (itemSource(baseItem) === itemSource(nextItem)) return {status: 'unchanged', text: bumped, conflicts: 0}
  const options = {style, version, notes: parsed.notes}
  const [base, theirs] = await Promise.all([transformItem(baseItem, options), transformItem(nextItem, options)])
  const merged = await mergeFile({ours: bumped, base, theirs}, [
    `ours (${name}.tsx)`,
    `base (shadcn@${parsed.version})`,
    `upstream (shadcn@${version})`,
  ])
  return {status: merged.conflicts ? 'conflict' : 'merged', ...merged}
}
