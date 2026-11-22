// The set of files a release publishes to the schemas host (docs/contracts.md#versioning-and-publishing), checked
// before anything is uploaded:
//
//   node scripts/publication.mjs                              check the committed schemas form a complete set
//   node scripts/publication.mjs --release v0.2.0 --out DIR   also write the release's files to DIR
//
// DIR receives `snapshots/<name>/v<major>/<release>.json`, immutable, and, unless the release is a prerelease,
// `current/<name>/v<major>.json`, which replaces each schema at its ID. Each file is the committed schema, byte
// for byte. Run `npm run build` first: the schemas' base URL and TypeBox sources come from dist.
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const directory = join(root, 'schemas')

/** A release version from a release tag (`v0.2.0`, `projections-cli/v0.2.0`) or version (`0.2.0-beta.1`). */
export function releaseVersion(tag) {
  const version = String(tag).replace(/^.*\//u, '').replace(/^v/u, '')
  // Build metadata (`+…`) is excluded: it isn't part of a release's identity and doesn't belong in a URL.
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(version)) {
    throw new Error(`${tag} is not a release version, such as v0.2.0 or v0.2.0-beta.1`)
  }
  return {version, prerelease: version.includes('-')}
}

function* references(value) {
  if (Array.isArray(value)) for (const item of value) yield* references(item)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') yield item
      else yield* references(item)
    }
  }
}

function resolvePointer(document, pointer) {
  let value = document
  for (const token of pointer.split('/').slice(1)) {
    const key = decodeURIComponent(token).replaceAll('~1', '/').replaceAll('~0', '~')
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
    value = value[key]
  }
  return value
}

/**
 * The committed schemas as a publishable set, or the reasons they aren't one: every file is at its `$id` below
 * the schemas host, every `$ref` resolves within the set through the host, and the set is exactly what the
 * TypeBox sources emit, including every domain schema and vocabulary.
 */
export async function publication() {
  const {domainSchemas, schemaBaseUrl, vocabularyNames} = await import('../dist/index.js')
  const {emit, schemaDocuments} = await import('../dist/typebox/index.js')
  const problems = []
  const paths = readdirSync(directory, {recursive: true})
    .map(path => path.split('\\').join('/'))
    .filter(path => path.endsWith('.json'))
    .sort()
  const files = paths.map(path => {
    const bytes = readFileSync(join(directory, path))
    return {path, bytes, schema: JSON.parse(bytes.toString('utf8'))}
  })
  const byId = new Map(files.map(file => [file.schema.$id, file]))

  for (const {path, schema} of files) {
    if (!/^(?:[a-z0-9][a-z0-9-]*\/){1,2}v\d+\.json$/u.test(path)) problems.push(`${path} is not at <name>/v<major>.json`)
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') problems.push(`${path} is not draft 2020-12`)
    if (schema.$id !== `${schemaBaseUrl}${path}`) problems.push(`${path} has the $id ${schema.$id}, not ${schemaBaseUrl}${path}`)
    for (const reference of references(schema)) {
      const [document, fragment = ''] = reference.split('#')
      let target = schema
      if (document) {
        if (!document.startsWith(schemaBaseUrl)) {
          problems.push(`${path} refers to ${reference}, outside ${schemaBaseUrl}`)
          continue
        }
        target = byId.get(document)?.schema
        if (!target) {
          problems.push(`${path} refers to ${reference}, which isn't published`)
          continue
        }
      }
      if (fragment && resolvePointer(target, fragment) === undefined) problems.push(`${path} refers to ${reference}, which doesn't resolve`)
    }
  }

  const emitted = new Set(emit(schemaDocuments).map(({path}) => path))
  for (const path of emitted) if (!paths.includes(path)) problems.push(`${path} is missing; run npm run generate`)
  for (const path of paths) if (!emitted.has(path)) problems.push(`${path} isn't generated from the TypeBox sources`)
  for (const name of [...domainSchemas, ...vocabularyNames.map(name => `vocabularies/${name}`)]) {
    if (!paths.includes(`${name}.json`)) problems.push(`${name}.json, a domain schema or vocabulary, is missing`)
  }

  return {base: schemaBaseUrl, files: files.map(({path, bytes}) => ({path, bytes})), problems}
}

/** The files a release publishes, relative to the schemas host: its snapshots, and its majors unless a prerelease. */
export function releaseFiles(files, tag) {
  const {version, prerelease} = releaseVersion(tag)
  return {
    version,
    prerelease,
    snapshots: files.map(({path, bytes}) => ({path: path.replace(/\.json$/u, `/${version}.json`), bytes})),
    current: prerelease ? [] : files,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const option = name => {
    const index = process.argv.indexOf(name)
    return index === -1 ? undefined : process.argv[index + 1]
  }
  const {base, files, problems} = await publication()
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
  const tag = option('--release')
  const out = option('--out')
  if (!tag) {
    console.log(`${files.length} schemas form a complete set at ${base}`)
  } else {
    if (!out) throw new Error('--release needs --out DIR')
    const release = releaseFiles(files, tag)
    for (const [kind, list] of [
      ['snapshots', release.snapshots],
      ['current', release.current],
    ]) {
      for (const {path, bytes} of list) {
        mkdirSync(dirname(join(out, kind, path)), {recursive: true})
        writeFileSync(join(out, kind, path), bytes)
      }
    }
    console.log(
      `${release.snapshots.length} snapshots for ${release.version}${
        release.prerelease
          ? ' (a prerelease: the schemas at their IDs are unchanged)'
          : `, and ${release.current.length} schemas at their IDs`
      } in ${out}, for ${base}`,
    )
  }
}
