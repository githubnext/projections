import {existsSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import type * as TypeScript from 'typescript'

/**
 * The examined repository's own Node packages. Revisions are materialized without
 * ignored files, so installed packages are resolved from the repository's working
 * checkout instead, and never from Projections itself.
 */
export interface Toolchain {
  /** Absolute, real path of the repository checkout whose installed packages are used. */
  checkout: string
}

export interface ResolvedPackage {
  name: string
  version: string
  directory: string
}

const within = (root: string, file: string): boolean => {
  const relative = path.relative(root, file)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** The checkout directory corresponding to a repository-relative path, or the checkout itself. */
export function startDirectory(toolchain: Toolchain, relative: string | undefined): string {
  if (relative === undefined || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return toolchain.checkout
  for (
    let directory = path.resolve(toolchain.checkout, relative);
    within(toolchain.checkout, directory);
    directory = path.dirname(directory)
  ) {
    try {
      if (statSync(directory).isDirectory()) return directory
    } catch {
      /* Not in this checkout; try its parent. */
    }
    if (directory === toolchain.checkout) break
  }
  return toolchain.checkout
}

/**
 * Finds an installed package the way Node looks up `node_modules` directories from
 * `start`, but only up to the checkout root, so a global or ancestor installation
 * is never used silently. Returns `undefined` when the package is not installed.
 */
export function resolvePackage(toolchain: Toolchain, start: string, name: string): ResolvedPackage | undefined {
  for (let directory = start; within(toolchain.checkout, directory); directory = path.dirname(directory)) {
    const manifest = path.join(directory, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(manifest)) {
      // Package managers may link installations (pnpm's store); the target must stay in the checkout too.
      const real = realpathSync(manifest)
      if (!within(toolchain.checkout, real)) {
        throw new Error(
          `The repository's ${name} package resolved outside the repository checkout (${real}). ` +
            `Install ${name} in the repository itself; Projections never uses global or ancestor installations.`,
        )
      }
      const parsed = JSON.parse(readFileSync(real, 'utf8')) as {name?: unknown; version?: unknown}
      if (parsed.name !== name || typeof parsed.version !== 'string') throw new Error(`Invalid installed ${name} package manifest: ${real}`)
      return {name, version: parsed.version, directory: path.dirname(real)}
    }
    if (directory === toolchain.checkout) break
  }
  return undefined
}

const major = (version: string): number => Number.parseInt(version, 10)

/** TypeScript releases whose JavaScript compiler API the TypeScript extractors use. */
export const SUPPORTED_TYPESCRIPT = '5.x or 6.x'
const TYPESCRIPT_6_API = '@typescript/typescript6'

/** The packages that install TypeScript 7's native compiler (`tsgo`), which has no JavaScript compiler API. */
const NATIVE_COMPILERS = ['@typescript/native-preview', '@typescript/native']

/** How to add a development dependency with the package manager whose lockfile the checkout has. */
function addDevDependency(toolchain: Toolchain, name: string): string {
  const has = (file: string): boolean => existsSync(path.join(toolchain.checkout, file))
  if (has('pnpm-lock.yaml')) return `pnpm add --save-dev --workspace-root ${name}`
  if (has('yarn.lock')) return `yarn add --dev ${name}`
  if (has('bun.lock') || has('bun.lockb')) return `bun add --dev ${name}`
  return `npm install --save-dev ${name}`
}

/** Why no compiler was found, and the one command that fixes it. */
function missingTypeScript(toolchain: Toolchain, start: string, extractor: string, where: string): string {
  const native = NATIVE_COMPILERS.map(name => resolvePackage(toolchain, start, name)).find(found => found !== undefined)
  const lead = `${extractor} uses the TypeScript ${SUPPORTED_TYPESCRIPT} compiler API from the repository's own installation, resolved from ${where} in the repository checkout.`
  if (native)
    return (
      `${lead} The repository has ${native.name} ${native.version} (TypeScript 7's native compiler), which has no JavaScript compiler API. ` +
      `Add the TypeScript 6 API package beside it: \`${addDevDependency(toolchain, TYPESCRIPT_6_API)}\`.`
    )
  return (
    `${lead} No \`typescript\` package is installed there. Run your package manager's install (for example \`npm ci\`), ` +
    `or, if the project doesn't depend on TypeScript, add it: \`${addDevDependency(toolchain, 'typescript@6')}\`. ` +
    'Projections does not bundle a TypeScript compiler.'
  )
}

/**
 * Loads the repository's own TypeScript compiler. TypeScript 7 is the native
 * compiler without the JavaScript compiler API, so a TypeScript 7 project must also
 * install the TypeScript 6 API package alongside it.
 */
export function loadTypeScript(
  toolchain: Toolchain,
  start: string,
  extractor: string,
): {ts: typeof TypeScript; version: string; package: string} {
  const where = path.relative(toolchain.checkout, start) || '.'
  const installed = resolvePackage(toolchain, start, 'typescript')
  const compatible = (resolved: ResolvedPackage | undefined): resolved is ResolvedPackage =>
    resolved !== undefined && major(resolved.version) >= 5 && major(resolved.version) <= 6
  let selected = compatible(installed) ? installed : undefined
  if (!selected && installed && major(installed.version) >= 7) {
    const api = resolvePackage(toolchain, start, TYPESCRIPT_6_API)
    if (compatible(api)) selected = api
    else
      throw new Error(
        `${extractor} uses the TypeScript ${SUPPORTED_TYPESCRIPT} compiler API. The repository's typescript ${installed.version} ` +
          `(resolved from ${where}) is the native compiler without that API; add ${TYPESCRIPT_6_API} as a development dependency and install it.`,
      )
  }
  if (!selected) {
    if (installed)
      throw new Error(
        `${extractor} requires TypeScript ${SUPPORTED_TYPESCRIPT}; the repository has typescript ${installed.version} (resolved from ${where}).`,
      )
    throw new Error(missingTypeScript(toolchain, start, extractor, where))
  }
  const required = createRequire(path.join(selected.directory, 'package.json'))(selected.directory) as typeof TypeScript
  const ts = (required as unknown as {default?: typeof TypeScript}).default?.createProgram
    ? (required as unknown as {default: typeof TypeScript}).default
    : required
  if (typeof ts.createProgram !== 'function' || typeof ts.version !== 'string') {
    throw new Error(`The repository's ${selected.name} ${selected.version} does not expose the TypeScript compiler API.`)
  }
  return {ts, version: ts.version, package: selected.name}
}
