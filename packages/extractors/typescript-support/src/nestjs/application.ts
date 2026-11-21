import {createRequire} from 'node:module'
import path from 'node:path'
import type {Extraction} from '../types.js'
import type {ResolvedPackage} from '../toolchain.js'
import {compose} from './compose.js'
import {describe, slash, type NestModule, type SerializedGraph} from './model.js'

interface ApplicationContext {
  get(token: unknown, options?: unknown): unknown
  container?: {getModules(): Map<string, NestModule>}
}
interface NestCore {
  NestFactory: {createApplicationContext(module: unknown, options: Record<string, unknown>): Promise<ApplicationContext>}
  SerializedGraph: unknown
  ModuleRef: unknown
  ApplicationConfig: unknown
}

export interface Application {
  root: string
  core: ResolvedPackage
  moduleFile: string
  moduleName: string
  entry: string | undefined
  include: string
}

/** Loads the root module, composes it in preview mode with the repository's `@nestjs/core`, and reads its container. */
export async function composeApplication({root, core, moduleFile, moduleName, entry, include}: Application): Promise<Extraction> {
  const load = createRequire(path.join(core.directory, 'package.json'))
  const nest = load(core.directory) as NestCore
  let exported: Record<string, unknown>
  try {
    exported = createRequire(moduleFile)(moduleFile) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Cannot load the root module ${slash(path.relative(root, moduleFile))}: ${describe(error)}`, {cause: error})
  }
  const rootClass = exported[moduleName]
  if (typeof rootClass !== 'function') {
    throw new Error(`${slash(path.relative(root, moduleFile))} does not export the module class ${moduleName}.`)
  }
  let application: ApplicationContext
  try {
    application = await nest.NestFactory.createApplicationContext(rootClass, {
      preview: true,
      snapshot: true,
      logger: false,
      abortOnError: false,
    })
  } catch (error) {
    throw new Error(`NestJS could not compose ${moduleName} in preview mode: ${describe(error)}`, {cause: error})
  }
  const graph = (application.get(nest.SerializedGraph, {strict: false}) as SerializedGraph).toJSON()
  if (graph.status === 'partial') throw new Error(`NestJS composed only part of ${moduleName}: ${JSON.stringify(graph.metadata ?? {})}`)
  const container = application.container
  if (!container) throw new Error('This @nestjs/core does not expose its container to the application context.')
  const coreProviders = new Set([nest.ModuleRef, nest.ApplicationConfig])
  return compose({
    root,
    rootName: moduleName,
    entry,
    include,
    nestVersion: core.version,
    graph,
    modules: [...container.getModules().values()],
    coreProviders,
  })
}
