import {test} from 'node:test'
import assert from 'node:assert/strict'
import {argumentSignature, cliDeclarations} from './cli.mjs'
import {pointerLines} from './json-lines.mjs'
import {fields, typeText} from './schemas.mjs'

test('a type names its definitions, lists alternatives and keeps its constraints', () => {
  assert.equal(typeText({$ref: '#/$defs/identifier'}), 'identifier')
  assert.equal(typeText({type: 'integer', minimum: 1, maximum: 300000}), 'integer (≥ 1, ≤ 300000)')
  assert.equal(typeText({anyOf: [{type: 'string'}, {type: 'object', properties: {a: {}}}]}), 'string | {…}')
  assert.equal(typeText({type: 'array', items: {enum: ['a', 'b']}, uniqueItems: true}), '("a" | "b")[] (unique)')
  // Alternatives that only require fields constrain the object; they aren't types of their own.
  assert.equal(typeText({type: 'object', properties: {a: {}}, oneOf: [{required: ['a']}, {required: ['b']}]}), '{…}')
})

test('fields come from properties and inline alternatives, one per name', () => {
  const schema = {
    anyOf: [
      {$ref: '#/$defs/file'},
      {type: 'object', required: ['file'], properties: {file: {type: 'string'}, options: {type: 'object'}}},
      {type: 'object', properties: {options: {$ref: '#/$defs/defaults'}}},
    ],
  }
  assert.deepEqual(
    fields(schema, '').map(field => [field.name, field.required, typeText(field.schema), field.pointer]),
    [
      ['file', true, 'string', '/anyOf/1/properties/file'],
      ['options', false, 'object | defaults', '/anyOf/1/properties/options'],
    ],
  )
})

test("a JSON Pointer's line is its key's", () => {
  const lines = pointerLines('{\n  "a": {\n    "b": [\n      1,\n      {"c": 2}\n    ]\n  }\n}\n')
  assert.equal(lines.get('/a'), 2)
  assert.equal(lines.get('/a/b'), 3)
  assert.equal(lines.get('/a/b/1/c'), 5)
})

test("an argument's signature keeps its values, literal default, repetition and requirement, not its prose", () => {
  assert.equal(argumentSignature('--last <N>', 'The recent changes (1-100). Default: `20`.'), '--last <N> = 20')
  assert.equal(
    argumentSignature('--definition <DEFINITION>', 'Default: base, or the working tree’s. One of: `base` — The base; `head` — The head.'),
    '--definition <DEFINITION>: "base" | "head"',
  )
  assert.equal(argumentSignature('--engine <E>', 'One of `docker`, `podman`.'), '--engine <E>: "docker" | "podman"')
  assert.equal(argumentSignature('-p, --projection <ID>', 'The projections. Repeatable.'), '-p, --projection <ID>...')
  assert.equal(argumentSignature('--out <FILE>', 'The PNG. Required.'), '--out <FILE> (required)')
})

test('commands and arguments come from the reference, without excluded commands', () => {
  const text = [
    '## Global options',
    '| `-C, --directory <DIR>` | Run there. Default: `.`. |',
    '## `projections check`',
    '```sh',
    'projections check [OPTIONS]',
    '```',
    '| `--png <FILE>` | Also a PNG. |',
    '## `projections mcp`',
    '| `--trust` | Run code. |',
  ].join('\n')
  const {entities, relationships} = cliDeclarations({text, source: 'cli.md', exclude: ['mcp']})
  assert.deepEqual(
    entities.map(entity => [entity.id, entity.label, entity.data.signature]),
    [
      ['cli:projections --directory', 'projections --directory', '-C, --directory <DIR> = .'],
      ['cli:projections check', 'projections check', 'projections check [OPTIONS]'],
      ['cli:projections check --png', 'check --png', '--png <FILE>'],
    ],
  )
  assert.deepEqual(
    relationships.map(relationship => relationship.id),
    ['takes:cli:projections check->cli:projections check --png'],
  )
})
