import {accessSync, chmodSync, constants, existsSync} from 'node:fs'
import {join} from 'node:path'
import type {RunnerInfo} from '../runner.ts'

/** Where the `projections` executable came from. */
export type CliSource = 'bundled' | 'setting' | 'environment' | 'development' | 'path'

export interface CliLocation {
  path: string
  source: CliSource
}

/** The bundled executable's directory for a platform: `bin/<platform>-<arch>/`, as `scripts/package.mjs` stages it. */
export function bundledCli(extensionPath: string, platform: string = process.platform, arch: string = process.arch): string {
  return join(extensionPath, 'bin', `${platform}-${arch}`, platform === 'win32' ? 'projections.exe' : 'projections')
}

/**
 * The `projections` executable: the `projections.cliPath` setting, else `PROJECTIONS_CLI` (explicit choices win),
 * else the one bundled for this platform (a platform-specific extension package), else a development build beside
 * the extension (`../../cli/dist/projections`), else `projections` on `PATH`.
 */
export function resolveCli({
  setting,
  extensionPath,
  environment = process.env,
  platform = process.platform,
  arch = process.arch,
  exists = existsSync,
}: {
  setting: string | undefined
  extensionPath: string
  environment?: NodeJS.ProcessEnv
  platform?: string
  arch?: string
  exists?: (path: string) => boolean
}): CliLocation {
  if (setting?.trim()) return {path: setting.trim(), source: 'setting'}
  if (environment.PROJECTIONS_CLI?.trim()) return {path: environment.PROJECTIONS_CLI.trim(), source: 'environment'}
  const bundled = bundledCli(extensionPath, platform, arch)
  if (exists(bundled)) return {path: bundled, source: 'bundled'}
  const development = join(extensionPath, '..', '..', 'cli', 'dist', platform === 'win32' ? 'projections.exe' : 'projections')
  if (exists(development)) return {path: development, source: 'development'}
  return {path: 'projections', source: 'path'}
}

/** The `projections` executable's path (see `resolveCli`). */
export function cliPath(setting: string | undefined, extensionPath: string, environment = process.env): string {
  return resolveCli({setting, extensionPath, environment}).path
}

/** A bundled executable that lost its mode bits (an archive that doesn't keep them) is made executable again. */
export function ensureExecutable(path: string) {
  if (process.platform === 'win32') return
  try {
    accessSync(path, constants.X_OK)
  } catch {
    chmodSync(path, 0o755)
  }
}

/** The `initialize` protocols this extension speaks. */
export const supportedProtocols = [1]

/**
 * Whether a CLI version works with this extension version: the same major version, and for `0.x` the same minor
 * (semver's compatibility). Releases pin the CLI to the extension's version; a CLI from the setting or `PATH` may be
 * any compatible release.
 */
export function compatibleVersion(extension: string, cli: string): boolean {
  const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version.trim())?.slice(1, 4).map(Number)
  const [a, b] = [parse(extension), parse(cli)]
  if (!a || !b) return false
  return a[0] === b[0] && (a[0] !== 0 || a[1] === b[1])
}

/** Why a backend can't be used with this extension, or undefined when it can. */
export function incompatibility(info: RunnerInfo, extensionVersion: string, cli: CliLocation): string | undefined {
  const where = `${cli.path} (${cli.source === 'path' ? 'on PATH' : `from ${cli.source === 'setting' ? 'projections.cliPath' : cli.source === 'environment' ? 'PROJECTIONS_CLI' : `the ${cli.source} build`}`})`
  const fix =
    cli.source === 'bundled'
      ? 'Reinstall the Projections extension.'
      : `Install projections ${extensionVersion}, or point projections.cliPath at a compatible build.`
  if (!supportedProtocols.includes(info.protocol)) {
    return `projections ${info.version} at ${where} speaks protocol ${info.protocol}; this extension speaks ${supportedProtocols.join(', ')}. ${fix}`
  }
  if (!compatibleVersion(extensionVersion, info.version)) {
    return `projections ${info.version} at ${where} is not compatible with the Projections extension ${extensionVersion}. ${fix}`
  }
  return undefined
}
