import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {cycles, workspaceCycles} from '../src/lib/modules/cycles.ts'
import {exportedNames, importsOf} from '../src/lib/modules/syntax.ts'
import {unusedExports} from '../src/lib/modules/exports.ts'
import type {Unit} from '../src/lib/packages.ts'

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tools-modules-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), text)
  }
  return root
}
const unit = (path: string, name: string): Unit => ({
  path,
  kinds: ['npm'],
  readme: undefined,
  names: [name],
  description: undefined,
  source: 'front-matter',
  dependsOn: [],
  scripts: [],
})

test('cycles are strongly connected groups, largest first', () => {
  const graph = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
    ['d', ['e']],
    ['e', ['d']],
    ['f', ['f']],
    ['g', ['a']],
  ])
  assert.deepEqual(cycles(graph), [['a', 'b', 'c'], ['d', 'e'], ['f']])
})

test('a type-only import closes no cycle; a value import does', () => {
  const root = repository({
    'w/package.json': '{"name": "w"}',
    'w/src/a.ts': "import {b} from './b.js'\nexport const a = b",
    'w/src/b.ts': "import type {a} from './a.js'\nexport const b = 1",
    'w/src/c.ts': "import {d} from './d.js'\nexport const c = d",
    'w/src/d.ts': "import {c} from './c.js'\nexport const d = () => c",
  })
  assert.deepEqual(workspaceCycles(root, unit('w', 'w')), [['w/src/c.ts', 'w/src/d.ts']])
})

test('exports follow export * and named re-exports; unused ones are those no other file imports', () => {
  const root = repository({
    'lib/package.json': JSON.stringify({name: 'lib', exports: {'.': './dist/index.js', './extra': './dist/extra.js'}}),
    'lib/src/index.ts': "export * from './parts.js'\nexport {thing as renamed} from './thing.js'\nexport default 1",
    'lib/src/parts.ts': 'export function used() {}\nexport const unused = 1\nexport type Shape = {}',
    'lib/src/thing.ts': 'export const thing = 1',
    'lib/src/extra.ts': 'export const whole = 1',
    'app/src/main.ts': "import {used, type Shape} from 'lib'\nimport * as extra from 'lib/extra'",
  })
  assert.deepEqual(exportedNames(root, 'lib/src/index.ts').toSorted(), ['Shape', 'default', 'renamed', 'unused', 'used'])
  assert.deepEqual(importsOf('x.ts', "export {a} from 'p'\nconst m = await import('q')"), [
    {specifier: 'p', names: ['a'], typeOnly: false},
    {specifier: 'q', names: '*'},
  ])
  assert.deepEqual([...unusedExports(root, [unit('lib', 'lib')])], [['lib', [{entry: 'lib', names: ['default', 'renamed', 'unused']}]]])
})
