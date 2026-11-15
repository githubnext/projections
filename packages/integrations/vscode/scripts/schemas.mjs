// Bundles the Projections JSON Schemas (`packages/schemas/schemas/`) with the extension, so VS Code validates definitions and
// rules files offline. Each schema's `$id` names its published URL, `<base><name>/v<n>.json`; the base comes from the
// `$id`s themselves (whatever host and path the schemas are published under), never a hardcoded URL. In the bundled
// copies, references to other schemas under that base become relative file references, and `$id` is removed, so
// VS Code's JSON service resolves them from the extension's files instead of downloading them.
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import path from 'node:path'

/** Every `<name>/v<n>.json` under `directory`, with its parsed schema. */
async function read(directory, prefix = '') {
  const found = []
  for (const entry of await readdir(path.join(directory, prefix), {withFileTypes: true})) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await read(directory, relative)))
    else if (/^v\d+\.json$/.test(entry.name))
      found.push({file: relative, schema: JSON.parse(await readFile(path.join(directory, relative), 'utf8'))})
  }
  return found
}

/** The base URL every schema's `$id` shares: `$id` without its `<name>/v<n>.json`. */
export function schemaBase(schemas) {
  const bases = new Set()
  for (const {file, schema} of schemas) {
    if (typeof schema.$id !== 'string' || !schema.$id.endsWith(`/${file}`))
      throw new Error(`Schema ${file} has no $id ending in its path (${schema.$id})`)
    bases.add(schema.$id.slice(0, -file.length))
  }
  if (bases.size !== 1) throw new Error(`The schemas' $id bases differ: ${[...bases].join(', ')}`)
  return [...bases][0]
}

/** `schema` with references under `base` made relative to `file`, and without `$id`. */
export function localize(schema, file, base) {
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    const copy = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith(base)) {
        const [target, fragment] = child.slice(base.length).split('#')
        const relative = path.posix.relative(path.posix.dirname(file), target) || path.posix.basename(target)
        copy[key] = `${relative.startsWith('.') ? relative : `./${relative}`}${fragment === undefined ? '' : `#${fragment}`}`
      } else copy[key] = visit(child)
    }
    return copy
  }
  const {$id: _id, ...rest} = schema
  return visit(rest)
}

/**
 * Bundles the schemas in `source` into `destination` and returns `{base, schemas: {[$id]: bundled path}}`, which it
 * also writes as `index.json`.
 */
export async function bundleSchemas(source, destination) {
  const schemas = await read(source)
  const base = schemaBase(schemas)
  const index = {base, schemas: {}}
  for (const {file, schema} of schemas) {
    await mkdir(path.join(destination, path.dirname(file)), {recursive: true})
    await writeFile(path.join(destination, file), `${JSON.stringify(localize(schema, file, base), null, 2)}\n`)
    index.schemas[schema.$id] = file
  }
  await writeFile(path.join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  return index
}
