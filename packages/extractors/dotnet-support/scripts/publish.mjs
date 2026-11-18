// Publishes the slim, prebuilt, framework-dependent .NET helper that ships with the CLI.
// It contains only first-party code: Roslyn is referenced for compilation only and is
// loaded at extraction time from the SDK that built the examined project.
//
//   node packages/extractors/dotnet-support/scripts/publish.mjs
//
// Restoring and compiling happen here, at Projections build time, with the
// developer's .NET 8+ SDK and NuGet access. Extraction later runs the published
// `Projections.Dotnet.dll` with the inspected repository's own `dotnet` and never
// restores or builds the helper.
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

export const helperDirectory = fileURLToPath(new URL('../helper/', import.meta.url))
/** The gitignored output that a source checkout's extractors resolve. */
export const publishDirectory = path.join(helperDirectory, 'publish')
const project = 'Projections.Dotnet.csproj'
const minimumSdk = 8

class Unavailable extends Error {}

function sdkVersion(dotnet, env) {
  const probe = spawnSync(dotnet, ['--version'], {cwd: helperDirectory, env, encoding: 'utf8'})
  if (probe.error) throw new Unavailable(`\`${dotnet}\` could not be run (${probe.error.code ?? probe.error.message})`)
  const version = probe.stdout.trim()
  if (probe.status !== 0) throw new Unavailable(`\`${dotnet} --version\` failed: ${probe.stderr.trim() || version}`)
  if (!(Number.parseInt(version, 10) >= minimumSdk)) {
    throw new Unavailable(`\`${dotnet}\` selects SDK ${version}; ${minimumSdk}.0 or newer is required`)
  }
  return version
}

/**
 * Publishes the helper into `publishDirectory` and returns that directory.
 *
 * Returns `null` when no usable .NET SDK is available and `strict` is false, so a
 * build can omit the helper; the CLI then reports that the distribution lacks it.
 * A failure of an available SDK (restore, compile) always throws.
 */
export function publishHelper({
  dotnet = process.env.PROJECTIONS_DOTNET_EXECUTABLE || 'dotnet',
  strict = process.env.PROJECTIONS_REQUIRE_HELPERS === '1',
  log = message => console.error(message),
} = {}) {
  const env = {...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'}
  let version
  try {
    version = sdkVersion(dotnet, env)
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error
    const message = `The prebuilt .NET helper requires the .NET ${minimumSdk} SDK or newer at build time: ${error.message}.`
    if (strict)
      throw new Error(`${message} Every extractor helper is required (PROJECTIONS_REQUIRE_HELPERS=1 or an explicit publish).`, {
        cause: error,
      })
    log(
      `\n${'*'.repeat(78)}\nWARNING: ${message}\nOmitting the .NET helper: dotnet-public-api, dotnet-di and efcore-schema will report\nthat this distribution was built without it. Set PROJECTIONS_REQUIRE_HELPERS=1 to fail instead.\n${'*'.repeat(78)}\n`,
    )
    return null
  }
  // Published beside, then moved in only when it changed: the CLI's build embeds the helper and rebuilds (with
  // whole-program optimization, for minutes) whenever its files are rewritten, even with the same bytes.
  const staging = mkdtempSync(path.join(tmpdir(), 'projections-dotnet-helper-'))
  try {
    publishInto(dotnet, env, version, staging)
    if (!sameFiles(staging, publishDirectory)) {
      rmSync(publishDirectory, {recursive: true, force: true})
      cpSync(staging, publishDirectory, {recursive: true})
    }
  } finally {
    rmSync(staging, {recursive: true, force: true})
  }
  log(`Published the prebuilt .NET helper with SDK ${version} to ${publishDirectory}`)
  return publishDirectory
}

/** Whether two directories hold the same files with the same bytes (the helper's are flat). */
function sameFiles(left, right) {
  if (!existsSync(right)) return false
  const names = readdirSync(left).sort()
  if (JSON.stringify(names) !== JSON.stringify(readdirSync(right).sort())) return false
  return names.every(name => readFileSync(path.join(left, name)).equals(readFileSync(path.join(right, name))))
}

function publishInto(dotnet, env, version, output) {
  const result = spawnSync(
    dotnet,
    [
      'publish',
      project,
      '--configuration',
      'Release',
      '--output',
      output,
      '--nologo',
      '--disable-build-servers',
      '--verbosity',
      'quiet',
      // The committed packages.lock.json pins every (transitive) package and its content hash.
      '-p:RestoreLockedMode=true',
      '-p:ContinuousIntegrationBuild=true',
      '-p:UseSharedCompilation=false',
    ],
    {cwd: helperDirectory, env, stdio: 'inherit'},
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`dotnet publish of the .NET helper failed with ${result.status} (SDK ${version})`)
  if (!existsSync(path.join(output, 'Projections.Dotnet.dll'))) {
    throw new Error('dotnet publish did not produce Projections.Dotnet.dll')
  }
  verifyHelper(output)
}

/** The only files the published helper may contain: first-party code and host metadata. */
export const helperFiles = ['Projections.Dotnet.deps.json', 'Projections.Dotnet.dll', 'Projections.Dotnet.runtimeconfig.json']

/**
 * Verifies that the published helper ships no third-party code, so it needs no
 * third-party notices: Roslyn comes from the SDK that builds the examined project,
 * and dependency injection and EF Core from the examined application.
 */
export function verifyHelper(directory = publishDirectory) {
  const files = readdirSync(directory).sort()
  if (JSON.stringify(files) !== JSON.stringify(helperFiles)) {
    throw new Error(`The .NET helper must ship only ${helperFiles.join(', ')}; found ${files.join(', ')}`)
  }
  const deps = JSON.parse(readFileSync(path.join(directory, 'Projections.Dotnet.deps.json'), 'utf8'))
  for (const target of Object.values(deps.targets)) {
    for (const [id, entry] of Object.entries(target)) {
      if (deps.libraries[id]?.type === 'package' && (entry.runtime || entry.runtimeTargets || entry.native || entry.resources)) {
        throw new Error(`The .NET helper must not redistribute NuGet package ${id}; reference it with ExcludeAssets="runtime"`)
      }
    }
  }
  return directory
}

if (import.meta.main) {
  try {
    publishHelper({strict: true})
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
