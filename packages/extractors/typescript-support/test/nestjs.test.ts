import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {cp, mkdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {test, type TestContext} from 'node:test'
import {compareExtractions, installPackages, runHelper} from './support.ts'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import type {Entity, Extraction, Relationship} from '../src/types.js'

const fixtures = fileURLToPath(new URL('../../nestjs-di/tests/fixtures/', import.meta.url))
const scratch = fileURLToPath(new URL('./fixtures/', import.meta.url))
const engine = createNativeEngine()
const packages = ['@nestjs/core', '@nestjs/common', 'reflect-metadata', 'rxjs', 'typescript']

// One repository checkout with the application's packages installed; revisions are
// materialized beside it without node_modules, as the CLI materializes them.
const checkoutDirectory = path.join(scratch, `.toolchain-nestjs-${process.pid}`)
let prepared: Promise<string> | undefined
function checkout(): Promise<string> {
  prepared ??= (async () => {
    await rm(checkoutDirectory, {recursive: true, force: true})
    await installPackages(checkoutDirectory, packages)
    process.once('exit', () => import('node:fs').then(fs => fs.rmSync(checkoutDirectory, {recursive: true, force: true})))
    return checkoutDirectory
  })()
  return prepared
}

/** A materialized revision: the fixture application, optionally with the `after` overlay and extra files. */
async function revision(
  t: TestContext,
  {after = false, files = {}}: {after?: boolean; files?: Record<string, string>} = {},
): Promise<string> {
  const root = path.join(scratch, `.checkout-${randomUUID()}`)
  t.after(() => rm(root, {recursive: true, force: true}))
  await cp(path.join(fixtures, 'app'), root, {recursive: true})
  if (after) await cp(path.join(fixtures, 'after'), root, {recursive: true})
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true})
    await writeFile(path.join(root, file), text)
  }
  return root
}

function request(root: string, inputs: Record<string, unknown> = {}, trusted = true) {
  return {
    protocolVersion: 0,
    projection: {id: 'services', definition: {id: 'services', extractor: 'nestjs-di', renderer: 'dependency-injection', inputs}},
    repository: {root, revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
    capabilities: {trusted, network: false},
  }
}

async function collect(root: string, inputs: Record<string, unknown> = {}, from?: string): Promise<Extraction> {
  const result = await runHelper('nestjs-di', request(root, inputs), from ?? (await checkout()))
  assert.equal(result.status, 0, result.stderr)
  const state = JSON.parse(result.stdout) as Extraction
  await engine.normalize(state)
  return state
}

const entity = (state: Extraction, id: string): Entity => {
  const found = state.entities.find(item => item.id === id)
  assert.ok(found, `${id} in ${state.entities.map(item => item.id).join(', ')}`)
  return found
}
const edges = (state: Extraction, kind: string, from?: string): Relationship[] =>
  state.relationships.filter(item => item.kind === kind && (from === undefined || item.from === from))

test('the container NestJS composes in preview mode: tokens, scopes, factories, aliases and module boundaries', async t => {
  const root = await revision(t)
  const state = await collect(root)
  assert.equal(state.schema, 'architecture/v0')
  assert.equal(state.metadata?.rootModule, 'AppModule')
  assert.equal(state.metadata?.entry, 'src/main.ts')

  // Class, string and symbol tokens; services are scoped to the module that provides them.
  assert.equal(entity(state, 'service:OrdersModule:class:OrdersService').data?.tokenKind, 'class')
  assert.equal(entity(state, 'service:ConfigModule:string:APP_CONFIG').data?.exported, true)
  assert.equal(entity(state, 'service:OrdersModule:symbol:clock').label, 'Symbol(clock)')

  // The abstract-class contract and the class that satisfies it.
  const gateway = entity(state, 'service:PaymentsModule:class:PaymentGateway:registration')
  assert.equal(gateway.data?.registrationKind, 'class')
  assert.equal(entity(state, 'implementation:PaymentsModule:class:PaymentGateway').label, 'StripeGateway')
  assert.equal(entity(state, 'service:ConfigModule:string:APP_CONFIG:registration').data?.registrationKind, 'value')
  const clock = entity(state, 'service:OrdersModule:symbol:clock:registration')
  assert.equal(clock.data?.registrationKind, 'factory')
  assert.equal(entity(state, 'implementation:OrdersModule:symbol:clock').label, 'systemClock()')

  // useExisting is a registration that forwards to another service, not an implementation.
  assert.equal(entity(state, 'service:PaymentsModule:string:PAYMENTS:registration').data?.registrationKind, 'alias')
  assert.deepEqual(
    edges(state, 'aliases').map(edge => edge.to),
    ['service:PaymentsModule:class:PaymentGateway'],
  )
  assert.ok(!state.entities.some(item => item.id === 'implementation:PaymentsModule:string:PAYMENTS'))

  // Scopes: TRANSIENT and REQUEST map to lifetimes; a singleton injecting a
  // request-scoped provider is re-created per request, and says so.
  assert.deepEqual(
    [
      entity(state, 'service:OrdersModule:class:AuditLogger:registration').data?.lifetime,
      entity(state, 'service:OrdersModule:class:AuditLogger:registration').data?.scope,
    ],
    ['transient', 'TRANSIENT'],
  )
  assert.deepEqual(
    [
      entity(state, 'service:OrdersModule:class:RequestContext:registration').data?.lifetime,
      entity(state, 'service:OrdersModule:class:RequestContext:registration').data?.scope,
    ],
    ['scoped', 'REQUEST'],
  )
  const controller = entity(state, 'service:OrdersModule:class:OrdersController:registration')
  assert.deepEqual(
    [controller.data?.lifetime, controller.data?.declaredLifetime, controller.data?.role],
    ['scoped', 'singleton', 'controller'],
  )
  assert.equal(entity(state, 'service:OrdersModule:class:OrdersService:registration').data?.lifetime, 'singleton')

  // Constructor, @Inject and property dependencies resolve across module boundaries;
  // the unprovided optional METRICS dependency resolves to nothing.
  const service = edges(state, 'dependsOn', 'implementation:OrdersModule:class:OrdersService')
  assert.deepEqual(service.map(edge => [edge.data?.parameter, edge.to]).toSorted(), [
    ['audit', 'service:OrdersModule:class:AuditLogger'],
    ['clock', 'service:OrdersModule:symbol:clock'],
    ['payments', 'service:PaymentsModule:class:PaymentGateway'],
    ['repository', 'service:OrdersModule:class:OrdersRepository'],
  ])
  assert.equal(service.find(edge => edge.data?.parameter === 'audit')?.data?.injection, 'property')
  assert.ok(service.every(edge => edge.confidence === 'authoritative'))
  assert.deepEqual(
    edges(state, 'dependsOn', 'implementation:PaymentsModule:class:PaymentGateway').map(edge => edge.to),
    ['service:ConfigModule:string:APP_CONFIG'],
  )

  // Modules and their declared imports; the global ConfigModule is not an import of every module.
  assert.deepEqual(
    state.entities.filter(item => item.kind === 'module').map(item => item.label),
    ['AppModule', 'ConfigModule', 'OrdersModule', 'PaymentsModule'],
  )
  assert.deepEqual(
    edges(state, 'imports').map(edge => `${edge.from}→${edge.to}`),
    ['module:AppModule→module:ConfigModule', 'module:AppModule→module:OrdersModule', 'module:OrdersModule→module:PaymentsModule'],
  )
  assert.equal(entity(state, 'module:ConfigModule').data?.global, true)
  // Only application code: no Nest internals, and the bootstrap never ran.
  assert.ok(!state.entities.some(item => /ModuleRef|ApplicationConfig|InternalCoreModule/.test(item.id)))
  assert.ok(!existsSync(path.join(root, 'started.txt')), 'main.ts is never run')
  assert.ok(
    state.entities
      .filter(item => item.kind === 'implementation' && item.data?.type)
      .every(item => item.evidence?.[0]?.source.startsWith('src/')),
  )
})

test('adding a service, changing a lifetime and swapping an implementation', async t => {
  const before = await collect(await revision(t))
  const after = await collect(await revision(t, {after: true}))
  const comparison = await compareExtractions(before, after)
  const changed = (status: string) =>
    comparison.changes
      .filter(change => change.status === status)
      .flatMap(change => (change.status === 'removed' ? change.before : change.after))
  assert.ok(changed('added').includes('service:OrdersModule:class:NotificationsService'))
  assert.ok(changed('added').some(id => id.startsWith('implementation:OrdersModule:class:OrdersService:dependsOn:constructor:3')))
  assert.ok(changed('modified').includes('service:OrdersModule:class:AuditLogger:registration'), 'TRANSIENT became DEFAULT')
  assert.equal(entity(after, 'service:OrdersModule:class:AuditLogger:registration').data?.lifetime, 'singleton')
  assert.ok(
    changed('modified').includes('service:PaymentsModule:class:PaymentGateway:registration'),
    'the implementation behind the same token changed',
  )
  assert.equal(entity(after, 'implementation:PaymentsModule:class:PaymentGateway').label, 'AdyenGateway')
})

test('loading the application requires trust', async t => {
  const root = await revision(t)
  const result = await runHelper('nestjs-di', request(root, {}, false), await checkout())
  assert.equal(result.status, 1)
  assert.match(result.stderr, /pass --trust/)
})

test("the repository's own @nestjs/core is required, never a bundled one", async t => {
  const root = await revision(t)
  const bare = path.join(scratch, `.checkout-${randomUUID()}`)
  t.after(() => rm(bare, {recursive: true, force: true}))
  await installPackages(bare, ['typescript'])
  const result = await runHelper('nestjs-di', request(root), bare)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /nestjs-di requires the repository's own \x60@nestjs\/core\x60 package/)
})

test('an explicit root module, ECMAScript-style specifiers, path aliases, resolved optional dependencies and every framework provider', async t => {
  const root = await revision(t, {
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'commonjs',
          target: 'ES2021',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          baseUrl: '.',
          paths: {'@shared/*': ['src/shared/*']},
        },
      }),
      'src/shared/metrics.ts': `import { Injectable } from '@nestjs/common';\n@Injectable() export class Metrics { increment(name: string): void { void name; } }\n`,
      'src/standalone.module.ts': `import { Global, Module } from '@nestjs/common';
import { Metrics } from '@shared/metrics';
import { ConfigModule } from './config/config.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { METRICS } from './orders/tokens.js';
@Global()
@Module({ imports: [ConfigModule, OrdersModule], providers: [Metrics, { provide: METRICS, useExisting: Metrics }], exports: [METRICS] })
export class StandaloneModule {}
`,
    },
  })
  const state = await collect(root, {module: 'src/standalone.module.ts#StandaloneModule', include: 'all'})
  assert.equal(state.metadata?.rootModule, 'StandaloneModule')
  assert.equal(state.metadata?.entry, undefined)
  assert.ok(state.entities.some(item => item.id === 'module:InternalCoreModule'))
  assert.ok(state.entities.some(item => item.id === 'service:OrdersModule:class:ModuleRef' && item.kind === 'service'))
  assert.equal(entity(state, 'service:OrdersModule:class:ModuleRef:registration').data?.origin, 'framework')
  assert.equal(entity(state, 'service:StandaloneModule:class:Metrics:registration').data?.origin, 'application')
  // The global module's METRICS alias now satisfies the optional dependency.
  const metrics = edges(state, 'dependsOn', 'implementation:OrdersModule:class:OrdersService').find(
    edge => edge.data?.parameter === 'metrics',
  )
  assert.deepEqual([metrics?.to, metrics?.data?.optional, metrics?.data?.position], ['service:StandaloneModule:string:METRICS', true, 3])
  const error = await runHelper('nestjs-di', request(root, {module: 'src/standalone.module.ts'}), await checkout())
  assert.match(error.stderr, /inputs\.module must be "<file>#<exported module class>"/)
})

test('a bootstrap file is required when none is conventional', async t => {
  const root = await revision(t, {
    files: {
      'src/worker.ts': `import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\nvoid NestFactory.createApplicationContext(AppModule);\n`,
    },
  })
  await rm(path.join(root, 'src/main.ts'))
  await writeFile(
    path.join(root, 'src/server.ts'),
    `import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\nvoid NestFactory.create(AppModule);\n`,
  )
  const ambiguous = await runHelper('nestjs-di', request(root), await checkout())
  assert.match(ambiguous.stderr, /More than one bootstrap file calls NestFactory \(src\/server\.ts, src\/worker\.ts\)/)
  const state = await collect(root, {entry: 'src/worker.ts'})
  assert.equal(state.metadata?.entry, 'src/worker.ts')
})

test('a module class imported with several dynamic configurations keeps its identity when imports are reordered', async t => {
  const feature = (name: string) => `import { Inject, Injectable, Module } from '@nestjs/common';
import { FeatureModule } from './feature.module';
@Injectable() export class ${name}Service { constructor(@Inject('${name}_REPOSITORY') readonly repository: unknown) {} }
@Module({ imports: [FeatureModule.forFeature('${name}')], providers: [${name}Service] })
export class ${name}Module {}
`
  const files = (order: string) => ({
    'src/feature.module.ts': `import { DynamicModule, Module } from '@nestjs/common';
@Module({})
export class FeatureModule {
  static forFeature(name: string): DynamicModule {
    return { module: FeatureModule, providers: [{ provide: \`\${name}_REPOSITORY\`, useValue: { name } }], exports: [\`\${name}_REPOSITORY\`] };
  }
}
`,
    'src/a.module.ts': feature('A'),
    'src/b.module.ts': feature('B'),
    'src/root.module.ts': `import { Module } from '@nestjs/common';
import { AModule } from './a.module';
import { BModule } from './b.module';
@Module({ imports: [${order}] })
export class RootModule {}
`,
  })
  const ids = async (order: string) => {
    const state = await collect(await revision(t, {files: files(order)}), {module: 'src/root.module.ts#RootModule'})
    return state.entities
      .filter(item => item.id.includes('FeatureModule'))
      .map(item => item.id)
      .toSorted()
  }
  const forward = await ids('AModule, BModule')
  assert.ok(forward.includes('service:FeatureModule@AModule:string:A_REPOSITORY'), forward.join(', '))
  assert.ok(forward.includes('service:FeatureModule@BModule:string:B_REPOSITORY'), forward.join(', '))
  assert.deepEqual(await ids('BModule, AModule'), forward)
})
