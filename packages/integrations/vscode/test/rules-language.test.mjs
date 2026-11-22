// The comparator file language service on the extension's side: the worker, rules-editor.wasm's
// `projections_rules_editor`, and the conversion to VS Code's positions and token encoding (run after npm run build).
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  Debouncer,
  RulesService,
  codePointColumn,
  encodeTokens,
  rulesKind,
  tokenModifiers,
  tokenTypes,
  utf16Character,
  utf16Range,
} from '../src/rules-service.ts'
import {editorCall, hasEditor} from '../src/rules-worker.ts'

const wasm = fileURLToPath(new URL('../dist/rules-editor.wasm', import.meta.url))
const interpreter = fileURLToPath(new URL('../../../comparators/rules/dist/rules.wasm', import.meta.url))
const worker = new URL('../src/rules-worker.ts', import.meta.url)
const module = new WebAssembly.Module(readFileSync(wasm))

const rules = `format: projections.comparator
version: 0
variables:
  - name: label
    description: The marker before every summary.
    expression: "'😀 ' + json(before.schema)"
classify:
  summary: variables.label + change.id
`

test('comparator files and their tests are recognised by name', () => {
  assert.equal(rulesKind('/a/compare.comparator.yaml'), 'rules')
  assert.equal(rulesKind('/a/compare.comparator.yml'), 'rules')
  assert.equal(rulesKind('/a/compare.comparator.test.yaml'), 'tests')
  assert.equal(rulesKind('/a/compare.comparator.test.yml'), 'tests')
  assert.equal(rulesKind('/a/.github/workflows/ci.yaml'), undefined)
  assert.equal(rulesKind('/a/rules.yaml'), undefined)
  assert.equal(rulesKind('/a/compare.rules.yaml'), undefined)
  assert.equal(rulesKind('/a/compare.rules.test.yaml'), undefined)
})

test('columns convert between code points and UTF-16', () => {
  const line = "  x: '😀é' + y"
  // The emoji is two UTF-16 units and one code point.
  assert.equal(codePointColumn(line, 0), 1)
  assert.equal(codePointColumn(line, 8), 8)
  assert.equal(codePointColumn(line, 9), 9)
  assert.equal(utf16Character(line, 8), 8)
  assert.equal(utf16Character(line, 9), 9)
  for (let column = 1; column <= [...line].length + 1; column++) assert.equal(codePointColumn(line, utf16Character(line, column)), column)
  assert.deepEqual(
    utf16Range({line: 1, column: 7, endLine: 1, endColumn: 9}, () => line),
    {
      startLine: 0,
      startCharacter: 6,
      endLine: 0,
      endCharacter: 9,
    },
  )
})

test('semantic tokens are encoded relative to each other, in UTF-16', () => {
  const lines = ["a: '😀' + b", 'c: d']
  const data = encodeTokens(
    [
      {line: 2, column: 4, length: 1, type: 'variable', modifiers: []},
      {line: 1, column: 4, length: 3, type: 'string', modifiers: []},
      {line: 1, column: 10, length: 1, type: 'parameter', modifiers: ['readonly', 'defaultLibrary']},
      {line: 1, column: 8, length: 1, type: 'not-a-type', modifiers: []},
    ],
    index => lines[index],
  )
  assert.deepEqual(data, [
    ...[0, 3, 4, tokenTypes.indexOf('string'), 0],
    ...[
      0,
      7,
      1,
      tokenTypes.indexOf('parameter'),
      (1 << tokenModifiers.indexOf('readonly')) | (1 << tokenModifiers.indexOf('defaultLibrary')),
    ],
    ...[1, 3, 1, tokenTypes.indexOf('variable'), 0],
  ])
})

test('the shipped language service answers editor requests', () => {
  assert.ok(hasEditor(module))
  // Viewers download rules.wasm, which doesn't carry it.
  assert.equal(hasEditor(new WebAssembly.Module(readFileSync(interpreter))), false)
  const lines = rules.split('\n')
  const tokens = editorCall(module, {op: 'tokens', source: rules, kind: 'rules'}).tokens
  const spelled = tokens.map(token => [
    token.line,
    [...lines[token.line - 1]].slice(token.column - 1, token.column - 1 + token.length).join(''),
    token.type,
  ])
  assert.deepEqual(
    spelled.filter(([line]) => line === 6),
    [
      [6, "'😀 '", 'string'],
      [6, '+', 'operator'],
      [6, 'json', 'function'],
      [6, '(', 'operator'],
      [6, 'before', 'parameter'],
      [6, '.', 'operator'],
      [6, 'schema', 'property'],
      [6, ')', 'operator'],
    ],
  )
  // Every token's type is in the legend.
  for (const token of tokens) assert.ok(tokenTypes.includes(token.type), token.type)
  for (const token of tokens) for (const modifier of token.modifiers) assert.ok(tokenModifiers.includes(modifier), modifier)

  const broken = rules.replace('json(before.schema)', 'jsno(before.schema)')
  const [diagnostic] = editorCall(module, {op: 'diagnostics', source: broken, kind: 'rules'}).diagnostics
  assert.equal(diagnostic.severity, 'error')
  assert.match(diagnostic.message, /Undeclared function \x60jsno\x60; did you mean \x60json\x60\?/u)
  assert.deepEqual([diagnostic.line, diagnostic.column, diagnostic.endColumn], [6, 25, 29])

  const hover = editorCall(module, {op: 'hover', source: rules, kind: 'rules', line: 6, column: 26}).hover
  assert.match(hover.markdown, /^\x60\x60\x60\njson\(value: dyn\) -> string\n\x60\x60\x60/u)
  const variable = editorCall(module, {op: 'hover', source: rules, kind: 'rules', line: 8, column: 23}).hover
  assert.match(variable.markdown, /^\x60\x60\x60\nvariables\.label: string\n\x60\x60\x60\n\nThe marker before every summary\./u)

  const completions = editorCall(module, {op: 'complete', source: rules, kind: 'rules', line: 8, column: 22})
  assert.deepEqual(
    completions.items.map(item => item.label),
    ['label'],
  )
  assert.deepEqual(completions.range, {line: 8, column: 22, endColumn: 22})

  const tests = editorCall(module, {
    op: 'diagnostics',
    source: 'format: projections.comparator-tests\nversion: 0\ncases: 3\n',
    kind: 'tests',
  })
  assert.equal(tests.diagnostics[0].code, 'invalid-tests')
})

test('the service runs requests in a worker, and restarts it after a deadline', async () => {
  const options = {worker, wasm, deadlineMs: 10_000}
  const service = new RulesService(options)
  try {
    const diagnostics = await service.diagnostics(rules.replace('change.id', 'change.idd'), 'rules')
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0].message, /No field \x60idd\x60 on Change; did you mean \x60id\x60\?/u)
    const [hover, tokens] = await Promise.all([service.hover(rules, 'rules', 6, 26), service.tokens(rules, 'rules')])
    assert.match(hover.markdown, /json\(value: dyn\) -> string/u)
    assert.ok(tokens.length > 10)
    await assert.rejects(service.request({op: 'nope', source: '', kind: 'rules'}), /\x60op\x60 must be/u)
    // A worker that never answers is stopped at the deadline, and the next request starts a new one.
    service.dispose()
    options.worker = new URL('data:text/javascript,setInterval(() => {}, 1000)')
    options.deadlineMs = 200
    await assert.rejects(service.tokens(rules, 'rules'), /took longer than 200 ms/u)
    options.worker = worker
    assert.ok((await service.tokens(rules, 'rules')).length > 10)
  } finally {
    service.dispose()
  }
})

test('a module without the language service is reported, not fatal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'projections-rules-'))
  try {
    const empty = path.join(directory, 'empty.wasm')
    await writeFile(empty, new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))
    const service = new RulesService({worker, wasm: empty})
    await assert.rejects(service.tokens(rules, 'rules'), /has no projections_rules_editor/u)
    service.dispose()
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('the debouncer runs the last call for a key once typing pauses', async () => {
  const debouncer = new Debouncer(20)
  const ran = []
  debouncer.schedule('a', () => ran.push('a1'))
  debouncer.schedule('a', () => ran.push('a2'))
  debouncer.schedule('b', () => ran.push('b1'))
  debouncer.schedule('c', () => ran.push('c1'))
  debouncer.cancel('c')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(ran.sort(), ['a2', 'b1'])
  debouncer.dispose()
})
