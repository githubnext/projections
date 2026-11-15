import path from 'node:path'
import type {Extraction} from './types.js'
import {selectTypeScript} from './compiler.js'
import {loadTypeScript, resolvePackage, startDirectory} from './toolchain.js'
import {sourcePath, type ExtractorContext} from './shared.js'
import {composeApplication} from './nestjs/application.js'
import {compilerOptions, installLoader, quietly} from './nestjs/loader.js'
import {MINIMUM_NEST, nearest, optionalString, slash} from './nestjs/model.js'
import {rootModule} from './nestjs/root.js'

/**
 * `nestjs-di`: the application's NestJS container, read through the repository's
 * own `@nestjs/core`. The root module is loaded and composed in preview mode
 * (`NestFactory.createApplicationContext(root, {preview: true, snapshot: true})`),
 * which scans modules and resolves every dependency without instantiating a
 * provider; the serialized graph Nest's devtools read supplies the resolved edges.
 */

function version(value: string): [number, number] {
  const [major, minor] = value.split('.').map(part => Number.parseInt(part, 10))
  return [major ?? 0, minor ?? 0]
}

export async function collectNest(context: ExtractorContext): Promise<Extraction> {
  if (!context.input.capabilities.trusted) {
    throw new Error("nestjs-di loads the application's modules and runs their decorators and module factories; review it and pass --trust.")
  }
  const include = optionalString(context, 'include') ?? 'application'
  if (include !== 'application' && include !== 'all') throw new Error('inputs.include must be "application" or "all"')
  const root = await sourcePath(context, '.')
  // The compiler that reads the bootstrap file is the one nearest the configured sources.
  const hint = optionalString(context, 'module')?.split('#')[0] ?? optionalString(context, 'entry') ?? 'src/main.ts'
  selectTypeScript(loadTypeScript(context.toolchain, startDirectory(context.toolchain, path.posix.dirname(hint)), 'nestjs-di').ts)
  const {file: moduleFile, name: moduleName, entry} = await rootModule(context)
  const project = path.dirname(nearest(root, path.dirname(moduleFile), 'package.json') ?? path.join(root, 'package.json'))
  const relativeProject = slash(path.relative(root, project)) || '.'
  const start = startDirectory(context.toolchain, relativeProject)
  const core = resolvePackage(context.toolchain, start, '@nestjs/core')
  if (!core) {
    throw new Error(
      `nestjs-di requires the repository's own \`@nestjs/core\` package, resolved from ${relativeProject} in the repository checkout. ` +
        "Run your package manager's install (for example `npm ci`) before running Projections; Projections does not bundle NestJS.",
    )
  }
  const [major, minor] = version(core.version)
  if (major < MINIMUM_NEST[0] || (major === MINIMUM_NEST[0] && minor < MINIMUM_NEST[1])) {
    throw new Error(
      `nestjs-di requires @nestjs/core ${MINIMUM_NEST.join('.')} or newer, which provides preview mode and the serialized graph; the repository has ${core.version}.`,
    )
  }
  const configuredTsconfig = optionalString(context, 'tsconfig')
  const options = compilerOptions(
    root,
    configuredTsconfig ? await sourcePath(context, configuredTsconfig) : undefined,
    path.dirname(moduleFile),
  )
  const restore = installLoader(root, context.toolchain.checkout, options)
  const workingDirectory = process.cwd()
  // Configuration modules read files relative to the project, as when the application starts.
  process.chdir(project)
  try {
    return await quietly(() => composeApplication({root, core, moduleFile, moduleName, entry, include}))
  } finally {
    process.chdir(workingDirectory)
    restore()
  }
}
