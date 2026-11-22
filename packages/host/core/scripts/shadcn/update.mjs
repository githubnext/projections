#!/usr/bin/env node
// Updates the vendored shadcn/ui components to a new upstream release with a three-way merge (the vendor-branch
// practice): upstream/<name>.json is the pristine item we adapted, both it and the new item are transformed into our
// form (./transform.mjs), and `git merge-file` applies upstream's changes to our file. See
// ../../src/ui/components/README.md ("Updating from upstream"). Run it as `npm run tools -- update shadcn`, which
// passes --json and reports the result in the repository CLI's form.
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {parseArgs} from 'node:util'
import {mergeComponent} from './merge.mjs'
import {changesSince, fetchItem, latestRelease, normalizeVersion, RegistryError, repository, tagOf} from './registry.mjs'

const components = new URL('../../src/ui/components/', import.meta.url)
const upstream = new URL('upstream/', components)
const manifestUrl = new URL('manifest.json', upstream)
const versionedDocs = ['README.md', 'LICENSE.shadcn.txt', 'index.ts']

const usage = `Usage: npm run tools -- update shadcn [--check | --dry-run] [--version <x.y.z>] [--unreleased] [<component>...]
       node packages/host/core/scripts/shadcn/update.mjs [the same] [--json]

  --check        report which components changed upstream since our base; writes nothing, exits 1 if any did
  --dry-run      merge in memory and report clean merges and conflicts; writes nothing
  --version      the shadcn release to update to (default: the latest)
  --unreleased   accept a registry that has moved past the release (recorded as <version>+<main sha>)
  --json         print one JSON result (or {error}) on stdout instead of text
  <component>    limit to these components; names without a vendored file add them (at our release)`

const {values: options, positionals} = parseArgs({
  options: {
    check: {type: 'boolean'},
    'dry-run': {type: 'boolean'},
    version: {type: 'string'},
    unreleased: {type: 'boolean'},
    json: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'},
  },
  allowPositionals: true,
})

/** The request can't be carried out as asked (exit 2). */
class UsageError extends Error {
  constructor(message, hint) {
    super(message)
    this.hint = hint
  }
}

const say = text => {
  if (!options.json) console.log(text)
}
const readText = async url => readFile(url, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)))
const sameItem = (a, b) => JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
/** The 1-based line of the first conflict marker. */
const conflictLine = text => text.split('\n').findIndex(line => line.startsWith('<<<<<<< ')) + 1 || undefined

// Adding components only stays at our release; anything else defaults to the latest.
async function resolveRelease(manifest, adding) {
  const target = normalizeVersion(options.version ?? (adding ? manifest.version : await latestRelease()))
  const provenance = await changesSince(target).catch(error => {
    if (error instanceof RegistryError && [404, 422].includes(error.status) && options.version) {
      throw new UsageError(`No release ${tagOf(target)} in ${repository}`, 'Pass a released version, such as 4.23.0')
    }
    throw error
  })
  const moved = provenance.changes.length > 0
  const summary = moved
    ? `the registry (${repository} main@${provenance.head.slice(0, 7)}) has moved past ${tagOf(target)}:\n${provenance.changes
        .map(change => `  ${change.sha.slice(0, 7)} ${change.message} (${change.path})`)
        .join('\n')}`
    : `the registry (${repository} main@${provenance.head.slice(0, 7)}) builds ${tagOf(target)}: no build input changed since the tag`
  if (moved && !options.unreleased && !options.check) {
    throw new UsageError(
      `${summary}\nIts items are no longer ${tagOf(target)}.`,
      `Re-run with --unreleased to take them as ${target}+<main sha>, or pass an older --version`,
    )
  }
  const version = moved && options.unreleased ? `${target}+${provenance.head.slice(0, 7)}` : target
  say(`shadcn/ui ${manifest.style}: ours ${tagOf(manifest.version)}, upstream ${tagOf(version)}\n${summary}\n`)
  return {
    version,
    tag: tagOf(target),
    commit: provenance.tag.sha,
    registryCommit: provenance.head,
    registry: {repository, head: provenance.head, moved: provenance.changes},
  }
}

async function check(names, items) {
  const results = []
  for (const [index, name] of names.entries()) {
    const base = await readText(new URL(`${name}.json`, upstream))
    results.push({name, status: !base ? 'new' : sameItem(base, items[index]) ? 'unchanged' : 'changed'})
  }
  for (const {name, status} of results) say(`  ${name.padEnd(16)} ${status}`)
  const changed = results.filter(result => result.status === 'changed').length
  say(changed ? `\n${changed} component(s) changed upstream.` : '\nNo component changed upstream.')
  return {components: results, failed: changed > 0}
}

async function update(manifest, release, names, items) {
  const dryRun = options['dry-run']
  const results = []
  for (const [index, name] of names.entries()) {
    const file = new URL(`${name}.tsx`, components)
    const baseText = await readText(new URL(`${name}.json`, upstream))
    const result = await mergeComponent({
      name,
      ours: await readText(file),
      baseItem: baseText && JSON.parse(baseText),
      nextItem: JSON.parse(items[index]),
      style: manifest.style,
      version: release.version,
    })
    results.push({name, status: result.status, ...(result.conflicts ? {conflicts: result.conflicts, line: conflictLine(result.text)} : {})})
    if (!dryRun) await Promise.all([writeFile(file, result.text), writeFile(new URL(`${name}.json`, upstream), items[index])])
  }
  for (const {name, status, conflicts} of results) say(`  ${name.padEnd(16)} ${status === 'conflict' ? `conflict (${conflicts})` : status}`)
  const conflicted = results.filter(result => result.status === 'conflict')
  if (!dryRun) {
    if (release.version !== manifest.version) {
      for (const doc of versionedDocs) {
        const url = new URL(doc, components)
        const text = await readFile(url, 'utf8')
        await writeFile(url, text.replaceAll(tagOf(manifest.version), tagOf(release.version)))
      }
    }
    const {version, tag, commit, registryCommit} = release
    await writeFile(manifestUrl, `${JSON.stringify({...manifest, version, tag, commit, registryCommit}, null, 2)}\n`)
  }
  const verb = dryRun ? 'would merge' : 'merged'
  say(
    conflicted.length
      ? `\n${conflicted.length} conflicted: ${dryRun ? 'an update would leave' : 'resolve'} the diff3 markers in ${conflicted.map(result => `${result.name}.tsx`).join(', ')}.`
      : `\nAll components ${verb} cleanly.`,
  )
  return {components: results, failed: conflicted.length > 0}
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  const tracked = (await readdir(upstream))
    .filter(file => file.endsWith('.json') && file !== 'manifest.json')
    .map(file => file.slice(0, -'.json'.length))
    .sort()
  if (options.check && options['dry-run']) throw new UsageError('Pass --check or --dry-run, not both')
  const names = positionals.length ? positionals : tracked
  const release = await resolveRelease(manifest, positionals.length > 0 && names.every(name => !tracked.includes(name)))
  const writes = !options.check && !options['dry-run']
  if (writes && release.version !== manifest.version && tracked.some(name => !names.includes(name))) {
    throw new UsageError(`Moving to ${tagOf(release.version)} updates every vendored component`, 'Omit the component names')
  }
  const items = await Promise.all(names.map(name => fetchItem(manifest.style, name)))
  const missing = names.filter((_, index) => items[index] == null)
  if (missing.length) throw new UsageError(`Not in the ${manifest.style} registry: ${missing.join(', ')}`)
  const outcome = await (options.check ? check(names, items) : update(manifest, release, names, items))
  return {
    status: outcome.failed ? 'fail' : 'pass',
    mode: options.check ? 'check' : options['dry-run'] ? 'dry-run' : 'update',
    style: manifest.style,
    ours: tagOf(manifest.version),
    upstream: tagOf(release.version),
    registry: release.registry,
    components: outcome.components,
    written: writes,
  }
}

/** Exit codes, as the repository CLI uses them: 1 changes or conflicts found, 2 usage, 3 a prerequisite (the network, git). */
function failure(error) {
  if (error instanceof UsageError) return {kind: 'usage', exitCode: 2}
  if (error instanceof RegistryError) return {kind: 'prerequisite', exitCode: 3}
  if (error?.code === 'ENOENT' && error?.path === 'git') return {kind: 'prerequisite', exitCode: 3, hint: 'Install git'}
  return undefined
}

if (options.help) {
  console.log(usage)
  process.exit(0)
}
try {
  const result = await main()
  if (options.json) console.log(JSON.stringify(result))
  process.exit(result.status === 'fail' ? 1 : 0)
} catch (error) {
  const known = failure(error)
  if (!known) throw error
  const hint = error.hint ?? known.hint
  if (options.json) console.log(JSON.stringify({error: {kind: known.kind, message: error.message, ...(hint ? {hint} : {})}}))
  else console.error(hint ? `${error.message}\n${hint}` : error.message)
  process.exit(known.exitCode)
}
