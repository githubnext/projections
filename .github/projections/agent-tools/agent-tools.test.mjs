// node --test .github/projections/agent-tools/agent-tools.test.mjs
//
// The extractor reads the CLI's catalog by evaluating its Rust literals. The VS Code manifest is written from the
// built CLI's tools/list (and checked against it in CI), so the evaluated catalog must give the very schemas the
// manifest holds, less what VS Code changes: `confirm` left out, `folder` added.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {catalogTools, vscodeTools} from './surfaces.mjs'
import {limitsText, typeText} from './rows.mjs'
import {rustModule, tokenize} from './rust-literals.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = file => readFileSync(`${root}${file}`, 'utf8')

test('the evaluated catalog has the schemas the CLI lists, as the VS Code manifest records them', () => {
  const catalog = catalogTools(read)
  const vscode = vscodeTools(read)
  assert.deepEqual(
    catalog.map(tool => tool.name),
    vscode.tools.map(tool => tool.name),
  )
  for (const tool of catalog) {
    const {properties, required, ...rest} = structuredClone(tool.schema)
    delete properties.confirm
    const expected = {...rest, properties, required: required.filter(name => name !== 'confirm')}
    const {properties: contributed, ...manifest} = structuredClone(vscode.tools.find(entry => entry.name === tool.name).schema)
    delete contributed.folder
    assert.deepEqual({...manifest, properties: contributed}, expected, tool.name)
  }
})

test('format!, helpers, consts and struct literals evaluate as Rust would', () => {
  const source = `
const VIEW: &str = "ui://v";
fn named(description: &str) -> Value {
    json!({"type": "string", "description": description, "uri": VIEW})
}`
  const {evaluate} = rustModule(source, 'test.rs')
  const value = evaluate(
    tokenize(`let x = "a \\"quoted\\" \\
        line"; Tool { name: "t", schema: named(&format!("{x} and {}", 2)), level: Trust::Write, list: &["a", "b"], off: false }`),
  )
  assert.deepEqual(value, {
    name: 't',
    schema: {type: 'string', description: 'a "quoted" line and 2', uri: 'ui://v'},
    level: 'Trust::Write',
    list: ['a', 'b'],
    off: false,
  })
  assert.throws(() => evaluate(tokenize('unknown_fn()')), /test\.rs:1: unknown function unknown_fn/u)
})

test('parameter types and limits read as agents read them', () => {
  assert.equal(typeText({type: 'string', enum: ['base', 'head']}), '"base" | "head"')
  assert.equal(typeText({type: ['string', 'object', 'null']}), 'string | object | null')
  assert.equal(typeText({type: 'array', items: {type: 'string'}}), 'string[]')
  assert.equal(limitsText({type: 'string', minLength: 1, maxLength: 100}), ' (1–100 chars)')
  assert.equal(limitsText({type: 'array', maxItems: 20}), ' (≤ 20 items)')
  assert.equal(limitsText({type: 'number', minimum: 0, maximum: 1}), ' (0–1)')
  assert.equal(limitsText({type: 'boolean'}), '')
})
