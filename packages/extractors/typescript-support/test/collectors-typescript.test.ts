import assert from 'node:assert/strict'
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {test, type TestContext} from 'node:test'
import {collectTypeScript, installToolchain, type HelperContext} from './support.ts'
import {canonicalize, compareExtractions} from './support.ts'
import type {WorkerExtractorId} from '../src/ids.js'
import type {Json} from '../src/types.js'
type Repository = HelperContext['input']['repository']
/** A fixture's invocation, its repository on disk at `root`. */
type Fixture = HelperContext & {input: HelperContext['input'] & {repository: Repository & {root: string}}}
const fixtureDirectory = path.resolve('test/fixtures/typescript')
const api = await readFile(path.join(fixtureDirectory, 'api.txt'), 'utf8')
async function fixture(
  t: TestContext,
  files: Record<string, string>,
  collector: WorkerExtractorId,
  inputs: Record<string, Json> = {},
): Promise<Fixture> {
  const root = path.join(fixtureDirectory, `.run-${randomUUID()}`)
  await mkdir(root, {recursive: true})
  t.after(() => rm(root, {recursive: true, force: true}))
  const all = {'package.json': JSON.stringify({name: '@example/app', types: './index.ts'}), ...files}
  for (const [file, text] of Object.entries(all)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true})
    await writeFile(path.join(root, file), text)
  }
  return {
    extractor: collector,
    files: Object.keys(all),
    input: {
      protocolVersion: 0,
      projection: {id: 'test', definition: {id: 'test', extractor: collector, renderer: 'graph', inputs}},
      repository: {root, mode: 'materialized', revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
      capabilities: {trusted: false, network: false},
    },
  }
}
test('public API resolves barrel aliases, overloads, classes, methods, generics and internal return shapes', async t => {
  const context = await fixture(
    t,
    {
      'index.ts': `export { Service, Box, Wrapped, choose as select, result } from './implementation.js';`,
      'implementation.ts': api,
    },
    'typescript-public-api',
  )
  const state = await collectTypeScript(context)
  assert.equal(state.schema, 'api/v0')
  assert.match(
    String(state.entities.find(node => node.label === 'select')?.data?.signature),
    /select\(input: string\): string; select\(input: number\): number/,
  )
  assert.match(String(state.entities.find(node => node.label === 'Box')?.data?.signature), /<T extends string = string>/)
  assert.match(String(state.entities.find(node => node.label === 'result')?.data?.signature), /"count": number; "name": string/)
  assert.match(String(state.entities.find(node => node.label === 'run')?.data?.signature), /"run"\(input: number\): number/)
  assert.ok(!state.entities.some(node => node.label === 'secret'))
  assert.ok(state.entities.every(node => typeof node.data?.signature === 'string'))
  assert.ok(state.entities.every(node => node.evidence?.[0]?.source && !path.isAbsolute(node.evidence[0].source)))
  assert.ok(!(await canonicalize(state)).includes(context.input.repository.root))
})
test('moves, formatting, member/export reordering and implementation-only edits do not change API', async t => {
  const before = await fixture(t, {'index.ts': `export * from './old.js';`, 'old.ts': api}, 'typescript-public-api')
  const after = await fixture(
    t,
    {
      'index.ts': `// barrel\nexport {result, choose, Wrapped, Box, Service} from "./moved.js";`,
      'moved.ts': api
        .replace('private secret = 1;', 'private completelyDifferent = "hidden";')
        .replace('interface Result { count: number; name: string }', 'interface Result {\n name: string;\n count: number\n}')
        .replace("return { count: 1, name: 'one' };", "return { name: 'changed body', count: 999 };")
        .replace('static version: number = 1;', 'static version: number = 20;')
        .replace(
          '  readonly value: T;\n  transform<U>(fn: (value: T) => U): U;',
          ' transform<U>(fn: (value: T) => U): U;\n readonly value:T;',
        ),
    },
    'typescript-public-api',
  )
  assert.equal((await compareExtractions(await collectTypeScript(before), await collectTypeScript(after))).changed, false)
})
test('meaningful signatures, overloads and reachable type shapes change API', async t => {
  const before = await fixture(t, {'index.ts': api}, 'typescript-public-api')
  const after = await fixture(t, {'index.ts': api.replace('count: number', 'count: number | null')}, 'typescript-public-api')
  assert.equal((await compareExtractions(await collectTypeScript(before), await collectTypeScript(after))).changed, true)
})
test('overlapping overload swaps change the exported signature and checker-selected return type', async t => {
  const wide = 'export function choose(x: any): "wide";'
  const narrow = 'export function choose(x: string): "narrow";'
  const implementation = `
    export function choose(x: unknown): "wide" | "narrow" { return "wide"; }
    export const selected = choose("value");`
  const before = await fixture(t, {'index.ts': `${wide}\n${narrow}${implementation}`}, 'typescript-public-api')
  const after = await fixture(t, {'index.ts': `${narrow}\n${wide}${implementation}`}, 'typescript-public-api')
  const left = await collectTypeScript(before)
  const right = await collectTypeScript(after)
  const chooseBefore = left.entities.find(node => node.label === 'choose')!
  const chooseAfter = right.entities.find(node => node.label === 'choose')!
  assert.equal(chooseBefore.id, chooseAfter.id)
  assert.notEqual(chooseBefore.data?.signature, chooseAfter.data?.signature)
  assert.match(String(chooseBefore.data?.signature), /^choose\(x: any\): "wide"; choose\(x: string\): "narrow"$/)
  assert.match(String(chooseAfter.data?.signature), /^choose\(x: string\): "narrow"; choose\(x: any\): "wide"$/)
  assert.equal(left.entities.find(node => node.label === 'selected')?.data?.signature, 'selected: "wide"')
  assert.equal(right.entities.find(node => node.label === 'selected')?.data?.signature, 'selected: "narrow"')
  assert.equal((await compareExtractions(left, right)).changes.find(change => change.id === chooseBefore.id)?.status, 'modified')
})
test('overload order survives method, constructor and structural callable rendering', async t => {
  const source = (first: string, second: string): string => {
    const types = [first, second]
    const calls = types.map(type => `(x: ${type}): "${type === 'any' ? 'wide' : 'narrow'}";`)
    return `
      export interface Callable { ${calls.join('\n')} }
      export interface Builder { ${calls.map(call => `new ${call}`).join('\n')} }
      export interface Methods { ${calls.map(call => `choose${call}`).join('\n')} }
      export class Constructed {
        ${types.map(type => `constructor(x: ${type});`).join('\n')}
        constructor(x: unknown) {}
      }
      export type Callback = { ${calls.join('\n')} };
      export type Composite = ${types.map(type => `((x: ${type}) => "${type === 'any' ? 'wide' : 'narrow'}")`).join(' & ')};
      export declare const nested: { handler: { ${calls.join('\n')} } };`
  }
  const before = await collectTypeScript(await fixture(t, {'index.ts': source('any', 'string')}, 'typescript-public-api'))
  const after = await collectTypeScript(await fixture(t, {'index.ts': source('string', 'any')}, 'typescript-public-api'))
  assert.deepEqual(
    before.entities.map(node => node.id),
    after.entities.map(node => node.id),
  )
  for (const label of ['call', 'construct', 'choose', 'constructor', 'Callback', 'Composite', 'nested']) {
    const left = before.entities.find(node => node.label === label)!
    const right = after.entities.find(node => node.id === left.id)!
    assert.notEqual(left.data?.signature, right.data?.signature, `${label} must retain checker overload order`)
  }
})
test('private and hash-private nominal brands change class APIs without exposing private details', async t => {
  const source = (privateMember: string): string => `export class Token { readonly value: number = 1; ${privateMember} }`
  // The markers are TypeScript's own contract facts; false ones are left out.
  const brand = (node: {data?: Record<string, unknown>} | undefined, name: 'nominalBrand' | 'staticNominalBrand') =>
    ((node?.data?.contract as {native?: Record<string, Json>} | undefined)?.native?.[name] ?? false) as boolean
  const structural = await collectTypeScript(await fixture(t, {'index.ts': source('')}, 'typescript-public-api'))
  const unbranded = structural.entities.find(node => node.label === 'Token')!
  assert.equal(brand(unbranded, 'nominalBrand'), false)
  assert.equal(brand(unbranded, 'staticNominalBrand'), false)
  for (const declaration of ['private hiddenBrand = "secret payload";', '#runtimeBrand = "secret payload";']) {
    const branded = await collectTypeScript(await fixture(t, {'index.ts': source(declaration)}, 'typescript-public-api'))
    const token = branded.entities.find(node => node.label === 'Token')!
    assert.equal(token.id, unbranded.id)
    assert.equal(brand(token, 'nominalBrand'), true)
    assert.equal((await compareExtractions(structural, branded)).changes.find(change => change.id === token.id)?.status, 'modified')
    assert.doesNotMatch(await canonicalize(branded), /hiddenBrand|runtimeBrand|secret payload/)
    const renamed = await collectTypeScript(
      await fixture(
        t,
        {
          'index.ts': source(
            declaration.replace('hiddenBrand', 'renamedBrand').replace('runtimeBrand', 'anotherBrand').replace('"secret payload"', '123'),
          ),
        },
        'typescript-public-api',
      ),
    )
    assert.equal((await compareExtractions(branded, renamed)).changed, false)
  }
  const staticBrand = await collectTypeScript(
    await fixture(
      t,
      {
        'index.ts': source('private static hiddenStatic = 1;'),
      },
      'typescript-public-api',
    ),
  )
  assert.equal(
    brand(
      staticBrand.entities.find(node => node.label === 'Token'),
      'nominalBrand',
    ),
    false,
  )
  assert.equal(
    brand(
      staticBrand.entities.find(node => node.label === 'Token'),
      'staticNominalBrand',
    ),
    true,
  )
  assert.equal((await compareExtractions(structural, staticBrand)).changed, true)
})
test('mapped types retain their public transformation', async t => {
  const before = await fixture(t, {'index.ts': 'export type Flags<T> = { [K in keyof T]?: T[K] };'}, 'typescript-public-api')
  const after = await fixture(t, {'index.ts': 'export type Flags<T> = { readonly [K in keyof T]: T[K] };'}, 'typescript-public-api')
  assert.equal((await compareExtractions(await collectTypeScript(before), await collectTypeScript(after))).changed, true)
})
test('callable interfaces, predicates and computed members have stable, observable signatures', async t => {
  const declarations = `export interface Callable { (value: string): number; }
    export interface IterableValue { [Symbol.iterator](): Iterator<string>; }
    export function isText(value: unknown): value is string { return typeof value === "string"; }`
  const before = await fixture(t, {'index.ts': declarations}, 'typescript-public-api')
  const moved = await fixture(
    t,
    {'index.ts': 'export * from "./moved.js";', 'moved.ts': declarations.replace('[Symbol.iterator]', '[ Symbol . iterator ]')},
    'typescript-public-api',
  )
  const state = await collectTypeScript(before)
  assert.ok(state.entities.some(node => node.label === 'call' && String(node.data?.signature).includes('(value: string): number')))
  assert.match(String(state.entities.find(node => node.label === 'isText')?.data?.signature), /value is string/)
  assert.equal(await canonicalize(state), await canonicalize(await collectTypeScript(moved)))
  const changed = await fixture(
    t,
    {'index.ts': declarations.replace('(value: string): number', '(value: string): boolean')},
    'typescript-public-api',
  )
  assert.equal((await compareExtractions(state, await collectTypeScript(changed))).changed, true)
})
test('conditional package exports, wildcard subpaths and types are explicit stable entrypoints', async t => {
  const context = await fixture(
    t,
    {
      'package.json': JSON.stringify({
        name: 'library',
        exports: {'.': {types: './index.ts', default: './dist/index.js'}, './features/*': './features/*.ts'},
      }),
      'index.ts': 'export const main: number = 1;',
      'features/one.ts': 'export interface One { enabled: boolean }',
    },
    'typescript-public-api',
  )
  const state = await collectTypeScript(context)
  assert.deepEqual(
    state.entities
      .filter(node => node.kind !== 'member')
      .map(node => node.data?.subpath)
      .toSorted(),
    ['.', './features/one'],
  )
})
test('a wildcard target with several `*` matches only files where each `*` is the same text', async t => {
  const context = await fixture(
    t,
    {
      'package.json': JSON.stringify({name: 'library', exports: {'./features/*': './features/*/*.ts'}}),
      'features/one/one.ts': 'export const one: number = 1;',
      'features/one/two.ts': 'export const two: number = 2;',
    },
    'typescript-public-api',
  )
  const state = await collectTypeScript(context)
  assert.deepEqual(
    state.entities.map(node => [node.label, node.data?.subpath]),
    [['one', './features/one']],
  )
})
test('a wildcard target needs a subpath with exactly one `*`', async t => {
  const context = await fixture(
    t,
    {
      'package.json': JSON.stringify({name: 'library', exports: {'./features': './features/*.ts'}}),
      'features/one.ts': 'export const one = 1;',
    },
    'typescript-public-api',
  )
  await assert.rejects(collectTypeScript(context), /maps to wildcard .* without exactly one/)
})
test('conditional exports with conflicting class members fail rather than dropping a surface', async t => {
  const context = await fixture(
    t,
    {
      'package.json': '{"name":"dual","exports":{".":{"import":"./a.ts","require":"./b.ts"}}}',
      'a.ts': 'export class Client { a(): string { return "a"; } }',
      'b.ts': 'export class Client { b(): number { return 1; } }',
    },
    'typescript-public-api',
  )
  await assert.rejects(collectTypeScript(context), /Conflicting public exports/)
})
test('tsconfig programs honor JSONC, extends, excludes and checker path aliases', async t => {
  const context = await fixture(
    t,
    {
      'tsconfig.base.json':
        '{ "compilerOptions": { "target":"ES2022", "module":"ESNext", "moduleResolution":"Bundler", "strict":true, "skipLibCheck":true, "types":[], "baseUrl":".", "paths":{"@models/*":["src/*"]} } }',
      'tsconfig.json': '{ // JSONC\n "extends":"./tsconfig.base.json", "include":["src/**/*.ts"], "exclude":["src/ignored.ts"] }',
      'src/index.ts': 'export { Value as PublicValue } from "@models/value";',
      'src/value.ts': 'export interface Value { id: number }',
      'src/ignored.ts': 'const broken: number = "wrong";',
    },
    'typescript-public-api',
    {entrypoints: {'.': 'src/index.ts'}},
  )
  const state = await collectTypeScript(context)
  assert.ok(state.entities.some(node => node.label === 'PublicValue'))
})
test('untracked installed declarations are read through guarded module resolution', async t => {
  const context = await fixture(
    t,
    {
      'index.ts': 'import { Thing } from "external"; export function read(value: Thing): string { return value.name; }',
      'node_modules/external/package.json': '{"name":"external","types":"./types.d.ts"}',
      'node_modules/external/types.d.ts': 'export interface Thing { name: string }',
    },
    'typescript-public-api',
  )
  context.files = context.files.filter(file => !file.startsWith('node_modules/'))
  const state = await collectTypeScript(context)
  assert.match(String(state.entities[0]?.data?.signature), /Thing/)
})
test('tsconfig default ambient type discovery respects installed @types packages', async t => {
  const context = await fixture(
    t,
    {
      'tsconfig.json':
        '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","skipLibCheck":true},"include":["index.ts"]}',
      'index.ts': 'export const value: number = fixtureAmbient;',
      'node_modules/@types/fixture-runtime/package.json': '{"name":"@types/fixture-runtime","types":"index.d.ts"}',
      'node_modules/@types/fixture-runtime/index.d.ts': 'declare const fixtureAmbient: number;',
    },
    'typescript-public-api',
  )
  context.files = context.files.filter(file => !file.startsWith('node_modules/'))
  assert.match(String((await collectTypeScript(context)).entities[0]?.data?.signature), /value: number/)
})
test('actionable diagnostics and missing config/entrypoints fail instead of empty success', async t => {
  await assert.rejects(
    collectTypeScript(await fixture(t, {'index.ts': 'export const x: number = "bad";'}, 'typescript-public-api')),
    /index\.ts:1: TS2322/,
  )
  await assert.rejects(
    collectTypeScript(await fixture(t, {'index.ts': 'export const = ;'}, 'typescript-public-api')),
    /TypeScript analysis failed/,
  )
  await assert.rejects(
    collectTypeScript(await fixture(t, {'index.ts': 'export const x = 1;'}, 'typescript-public-api', {tsconfig: 'missing.json'})),
    /ENOENT|Missing/,
  )
  await assert.rejects(
    collectTypeScript(await fixture(t, {'package.json': '{"name":"app"}', 'index.ts': 'export const x = 1;'}, 'typescript-public-api')),
    /Cannot identify the public API. Define \x60package.json\x60 \x60exports\x60 or \x60types\x60/,
  )
})
test('unsafe paths and symlinks leaving the repository are rejected; symlinks inside it are followed', async t => {
  const context = await fixture(t, {'index.ts': 'export const value = 1;'}, 'typescript-public-api')
  const escaping = structuredClone(context)
  escaping.input.projection.definition.inputs = {entrypoints: ['../outside.ts']}
  await assert.rejects(collectTypeScript(escaping), /Path must stay within/)
  const root = context.input.repository.root
  await symlink(path.join(root, 'index.ts'), path.join(root, 'linked.ts'))
  // An in-repository link is an alias of its target, never a second source.
  const followed = await collectTypeScript({...context, files: [...context.files, 'linked.ts']})
  assert.deepEqual(
    followed.entities.map(node => node.label),
    ['value'],
  )
  const outside = await fixture(t, {'secret.ts': 'export const secret = 1;'}, 'typescript-public-api')
  await symlink(path.join(outside.input.repository.root, 'secret.ts'), path.join(root, 'escape.ts'))
  await assert.rejects(collectTypeScript({...context, files: [...context.files, 'escape.ts']}), /symlinks that leave the repository/)
})
test('a materialized revision reads installed dependencies from the checkout, and workspace packages from the revision', async t => {
  const workspace = {
    'package.json': JSON.stringify({name: 'workspace', private: true, workspaces: ['packages/*']}),
    'packages/shapes/package.json': JSON.stringify({name: '@acme/shapes', type: 'module', exports: {'.': {types: './src/index.ts'}}}),
  }
  // The examined revision: no node_modules, as the runner materializes it.
  const context = await fixture(
    t,
    {
      ...workspace,
      'packages/client/package.json': JSON.stringify({name: '@acme/client', exports: {'.': {types: './src/index.ts'}}}),
      'packages/client/tsconfig.json': JSON.stringify({
        compilerOptions: {target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [], noEmit: true},
        include: ['src/**/*.ts'],
      }),
      'packages/client/src/index.ts':
        'import type {Shape} from "@acme/shapes"; import type {Money} from "money"; export function price(shape: Shape, rate: Money): Money { return {...rate, amount: rate.amount * shape.width * shape.height} }',
      'packages/shapes/src/index.ts': 'export interface Shape { width: number; height: number }',
    },
    'typescript-public-api',
    {tsconfig: 'packages/client/tsconfig.json'},
  )
  // The user's checkout: installed packages, a workspace link and an older working copy of the linked package.
  const checkout = path.join(fixtureDirectory, `.checkout-${randomUUID()}`)
  t.after(() => rm(checkout, {recursive: true, force: true}))
  await installToolchain(checkout)
  for (const [file, text] of Object.entries({
    ...workspace,
    'packages/shapes/src/index.ts': 'export interface Shape { width: number }',
    'node_modules/money/package.json': JSON.stringify({name: 'money', types: './index.d.ts'}),
    'node_modules/money/index.d.ts': 'export interface Money { amount: number; currency: string }',
  })) {
    await mkdir(path.dirname(path.join(checkout, file)), {recursive: true})
    await writeFile(path.join(checkout, file), text)
  }
  await mkdir(path.join(checkout, 'node_modules/@acme'), {recursive: true})
  await symlink(path.join(checkout, 'packages/shapes'), path.join(checkout, 'node_modules/@acme/shapes'), 'dir')
  const state = await collectTypeScript({...context, checkout})
  const price = state.entities.find(node => node.label === 'price')
  // `Shape` is the revision's (with `height`), `Money` the installed package's declaration.
  assert.equal(price?.data?.signature, 'price(shape: { "height": number; "width": number }, rate: Money): Money')
  assert.ok(state.entities.every(node => !node.evidence?.some(item => item.source.includes('node_modules'))))
  // Links in the checkout may not leave it.
  const outside = path.join(fixtureDirectory, `.outside-${randomUUID()}`)
  t.after(() => rm(outside, {recursive: true, force: true}))
  await mkdir(outside, {recursive: true})
  await writeFile(path.join(outside, 'package.json'), JSON.stringify({name: 'money', types: './index.d.ts'}))
  await rm(path.join(checkout, 'node_modules/money'), {recursive: true})
  await symlink(outside, path.join(checkout, 'node_modules/money'), 'dir')
  await assert.rejects(collectTypeScript({...context, checkout}), /symlinks that leave the repository/)
})
test("inherited library members cite the repository declaration, never the compiler's lib files", async t => {
  const context = await fixture(
    t,
    {'index.ts': 'export class HttpError extends Error {\n  constructor(readonly status: number) { super() }\n}'},
    'typescript-public-api',
  )
  const state = await collectTypeScript(context)
  const message = state.entities.find(node => node.id.endsWith(':instance:message'))
  assert.deepEqual(message?.evidence, [{kind: 'typescript', source: 'index.ts', location: {line: 1, column: 1}}])
  const sources = state.entities.flatMap(node => node.evidence ?? []).map(item => item.source)
  assert.deepEqual([...new Set(sources)], ['index.ts'])
})
test('run on a checkout, installed packages and tagged build caches are not program sources', async t => {
  const context = await fixture(
    t,
    {
      'index.ts': 'export const value = 1;',
      // Without a tsconfig every listed source is a root: these would fail if listed.
      'target/CACHEDIR.TAG': 'Signature: 8a477f597d28d172789f06886806bc55',
      'target/debug/broken.ts': 'export const broken: number = "wrong";',
      'node_modules/unrelated/broken.ts': 'export const broken: number = "wrong";',
    },
    'typescript-public-api',
  )
  assert.deepEqual(
    (await collectTypeScript(context)).entities.map(node => node.label),
    ['value'],
  )
})
test('a monorepo: workspace symlinks are followed and only the selected packages need unique names', async t => {
  const context = await fixture(
    t,
    {
      'package.json': JSON.stringify({name: 'workspace', private: true, workspaces: ['packages/*', 'examples/*']}),
      'packages/client/package.json': JSON.stringify({name: '@acme/client', exports: {'.': {types: './src/index.ts'}}}),
      'packages/client/tsconfig.json': JSON.stringify({
        compilerOptions: {target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [], noEmit: true},
        include: ['src/**/*.ts'],
      }),
      'packages/client/src/index.ts':
        'import type {Shape} from "@acme/shapes"; export function area(shape: Shape): number { return shape.width * shape.height }',
      'packages/shapes/package.json': JSON.stringify({name: '@acme/shapes', type: 'module', exports: {'.': {types: './src/index.ts'}}}),
      'packages/shapes/src/index.ts': 'export interface Shape { width: number; height: number }',
      // Unrelated fixtures that reuse a package name: not part of the selected program.
      'examples/one/package.json': JSON.stringify({name: 'example', types: './index.ts'}),
      'examples/one/index.ts': 'export const one = 1',
      'examples/two/package.json': JSON.stringify({name: 'example', types: './index.ts'}),
      'examples/two/index.ts': 'export const two = 2',
    },
    'typescript-public-api',
    {tsconfig: 'packages/client/tsconfig.json'},
  )
  const root = context.input.repository.root
  // The package manager's workspace link, untracked like the rest of node_modules.
  await mkdir(path.join(root, 'node_modules/@acme'), {recursive: true})
  await symlink(path.join(root, 'packages/shapes'), path.join(root, 'node_modules/@acme/shapes'), 'dir')
  const state = await collectTypeScript(context)
  const area = state.entities.find(node => node.label === 'area')
  assert.equal(area?.data?.package, '@acme/client')
  // `Shape` resolved through the link (not `any`); a dependency's source type is expanded structurally.
  assert.equal(area?.data?.signature, 'area(shape: { "height": number; "width": number }): number')
  // The dependency isn't exported itself, and nothing is attributed to node_modules.
  assert.ok(!state.entities.some(node => node.data?.package === '@acme/shapes' || node.data?.package === 'example'))
  assert.ok(state.entities.every(node => !node.evidence?.some(item => item.source.includes('node_modules'))))
  // Selecting the duplicates themselves still fails.
  const both = structuredClone(context)
  both.input.projection.definition.inputs = {entrypoints: {'.': 'examples/one/index.ts', './two': 'examples/two/index.ts'}}
  await assert.rejects(collectTypeScript(both), /Duplicate package name \x60example\x60/)
})
test('compiler resolution cannot follow outside-root imports or unlisted symlinked source', async t => {
  const outside = await fixture(t, {'index.ts': 'export interface Secret { value: string }'}, 'typescript-public-api')
  const context = await fixture(
    t,
    {
      'index.ts': `export { Secret } from ${JSON.stringify(path.join(outside.input.repository.root, 'index.js'))};`,
    },
    'typescript-public-api',
  )
  await assert.rejects(collectTypeScript(context), /TS2307/)
  await writeFile(path.join(context.input.repository.root, 'index.ts'), 'export { Secret } from "./linked.js";')
  await symlink(path.join(outside.input.repository.root, 'index.ts'), path.join(context.input.repository.root, 'linked.ts'))
  await assert.rejects(collectTypeScript(context), /symlinks/)
})
test('missing dependencies cannot be downgraded to success-shaped any public APIs', async t => {
  const context = await fixture(
    t,
    {
      'index.ts': 'import type { Missing } from "not-installed"; export function read(value: Missing): Missing { return value; }',
    },
    'typescript-public-api',
  )
  await assert.rejects(collectTypeScript(context), /TS2307/)
  // There is no input that skips semantic diagnostics.
  context.input.projection.definition.inputs = {diagnostics: 'syntax'}
  await assert.rejects(collectTypeScript(context), /TS2307/)
})
test('contract facts record checker-resolved types for API compatibility', async t => {
  const root = path.resolve('test/fixtures/compatibility/before')
  const state = await collectTypeScript({
    extractor: 'typescript-public-api',
    files: ['package.json', 'tsconfig.json', 'index.ts'],
    input: {
      protocolVersion: 0,
      projection: {
        id: 'api',
        definition: {id: 'api', extractor: 'typescript-public-api', renderer: 'api', inputs: {tsconfig: 'tsconfig.json'}},
      },
      repository: {root, mode: 'materialized', revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
      capabilities: {trusted: false, network: false},
    },
  })
  t.diagnostic(`${state.entities.length} declarations`)
  assert.equal(state.metadata?.ecosystem, 'typescript')
  const contract = (label: string) => state.entities.find(node => node.label === label)?.data?.contract as Record<string, Json>
  assert.deepEqual(contract('retry'), {
    declaration: 'function',
    term: 'function',
    visibility: 'public',
    signatures: [
      {
        parameters: [
          {name: 'job', type: {text: 'Job<unknown>', union: [{text: 'Job<unknown>'}]}, optional: false, variadic: false, passing: 'value'},
          {
            name: 'attempts',
            type: {
              text: 'number | string',
              union: [
                {text: 'number', primitive: 'number'},
                {text: 'string', primitive: 'string'},
              ],
            },
            optional: false,
            variadic: false,
            passing: 'value',
          },
        ],
        returns: {text: 'void', union: [{text: 'void', primitive: 'void'}]},
      },
    ],
  })
  assert.deepEqual(contract('Job'), {declaration: 'interface', term: 'interface', visibility: 'public'})
  assert.equal(contract('Status').declaration, 'alias')
  assert.deepEqual(
    (contract('priority').type as {union: Json[]}).union.map(item => (item as {text: string}).text),
    ['"high"', '"low"', '"normal"'],
  )
  assert.equal(contract('attempts').declaration, 'property')
  assert.equal(contract('name').readonly, true)
  assert.equal(contract('constructor').declaration, 'constructor')
  assert.equal(contract('Queue').declaration, 'class')
  assert.equal(contract('VERSION').declaration, 'variable')
})
