// Writes the published JSON Schemas (`schemas/<name>/v<version>.json`) from the TypeBox sources in
// `src/typebox`, and `fixtures/data-rules.json`, the domain data rules the engine's rule table must equal,
// formatted as the repository formats JSON. `--check` fails instead when a file differs.
import {execFileSync} from 'node:child_process'
import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const check = process.argv.includes('--check')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'schemas')
const {emit, schemaDocuments} = await import('../dist/typebox/index.js')
const {dataRules, vocabularies} = await import('../dist/domains.js')

const require = createRequire(import.meta.url)
const oxfmt = join(dirname(require.resolve('oxfmt/package.json')), 'bin/oxfmt')
const format = (path, text) =>
  execFileSync(process.execPath, [oxfmt, `--stdin-filepath=${path}`], {cwd: join(root, '../..'), input: text, encoding: 'utf8'})

// Small objects and arrays on one line, larger ones expanded; the formatter keeps that layout.
function stringify(value, indent = '') {
  const inline = JSON.stringify(value)
  if (!value || typeof value !== 'object' || inline.length + indent.length <= 100) return inline
  const inner = `${indent}  `
  const items = Array.isArray(value)
    ? value.map(item => `${inner}${stringify(item, inner)}`)
    : Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${stringify(item, inner)}`)
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return `${open}\n${items.join(',\n')}\n${indent}${close}`
}

const expected = new Map(emit(schemaDocuments).map(({path, json}) => [path, format(path, `${stringify(json)}\n`)]))
const existing = (function walk(directory) {
  let entries
  try {
    entries = readdirSync(directory, {withFileTypes: true})
  } catch {
    return []
  }
  return entries.flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [relative(output, join(directory, entry.name)).split('\\').join('/')],
  )
})(output)

// The engine's rule table, without the descriptions it doesn't need: a primitive type is its name; an enum
// `{enum: values}`; an array `{array: type}`; a record `{record: name, fields}`.
const shape = field =>
  field.type === 'enum'
    ? {enum: [...field.values]}
    : field.type === 'array'
      ? {array: shape(field.items)}
      : field.type === 'record'
        ? {record: field.name, fields: fieldsOf(field.fields)}
        : field.type
const fieldsOf = fields => Object.entries(fields).map(([name, field]) => ({name, type: shape(field), required: field.required === true}))
const rules = dataRules.map(({schema, vocabulary, collection, kinds, fields}) => ({
  schema,
  vocabulary: vocabulary ?? null,
  collection,
  kinds: kinds ?? null,
  fields: fieldsOf(fields),
}))
const fixture = join(root, 'fixtures/data-rules.json')
const fixtureText = format(
  'packages/schemas/fixtures/data-rules.json',
  `${stringify({version: 0, vocabularies: Object.fromEntries(Object.entries(vocabularies).map(([name, {schemas}]) => [name, schemas])), rules})}\n`,
)
let fixtureChanged
try {
  fixtureChanged = readFileSync(fixture, 'utf8') !== fixtureText
} catch {
  fixtureChanged = true
}

const stale = existing.filter(path => !expected.has(path))
const changed = [...expected].filter(([path, text]) => {
  try {
    return readFileSync(join(output, path), 'utf8') !== text
  } catch {
    return true
  }
})
if (check) {
  if (stale.length || changed.length || fixtureChanged) {
    for (const path of [...stale, ...changed.map(([path]) => path)]) console.error(`schemas/${path} is out of date`)
    if (fixtureChanged) console.error('fixtures/data-rules.json is out of date')
    console.error('Run `npm run generate --workspace @githubnext/projections-schemas`.')
    process.exit(1)
  }
} else {
  for (const path of stale) rmSync(join(output, path))
  for (const [path, text] of changed) {
    mkdirSync(dirname(join(output, path)), {recursive: true})
    writeFileSync(join(output, path), text)
  }
  if (fixtureChanged) writeFileSync(fixture, fixtureText)
  console.log(`${changed.length + (fixtureChanged ? 1 : 0)} written, ${stale.length} removed, ${expected.size} schemas`)
}
