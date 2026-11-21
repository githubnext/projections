import {execFileSync} from 'node:child_process'
import {lstat, readdir, realpath, stat} from 'node:fs/promises'
import path from 'node:path'
import {parseJson} from './json/parse.js'
import {validateDefinition} from './json/definition.js'
import type {ExtractorRequest} from './types.js'
import {collectBuiltin} from './catalog.js'
import {workerIds} from './ids.js'
import {record} from './shared.js'

/**
 * The examined files. A materialized revision has no ignored files; run on a
 * checkout, installed packages (`node_modules`, which the compiler reads on
 * demand) and build caches tagged with `CACHEDIR.TAG` (Cargo's `target`) are
 * skipped, since they are never program sources.
 */
async function files(root: string, prefix = '', result: string[] = []): Promise<string[]> {
  const entries = (await readdir(path.join(root, prefix), {withFileTypes: true})).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
  if (prefix && entries.some(entry => entry.name === 'CACHEDIR.TAG' && entry.isFile())) return result
  for (const entry of entries) {
    if (entry.name === '.git' || (entry.name === 'node_modules' && entry.isDirectory())) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) await files(root, relative, result)
    else result.push(relative)
    if (result.length > 50_000) throw new Error('Extractor input exceeds 50000 files')
  }
  return result
}

/**
 * The files of a checkout (the user's working tree read in place, or a
 * workspace): what Git lists there, tracked files and untracked ones it doesn't
 * ignore, so installed packages and build output are never sources.
 */
async function listed(root: string): Promise<string[]> {
  const output = execFileSync(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      env: {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0'},
    },
  )
  const result: string[] = []
  for (const name of new Set(output.toString('utf8').split('\0'))) {
    if (!name || name.endsWith('/')) continue
    const entry = await lstat(path.join(root, name)).catch(() => undefined)
    if (entry && (entry.isFile() || entry.isSymbolicLink())) result.push(name)
  }
  if (result.length > 50_000) throw new Error('Extractor input exceeds 50000 files')
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The oldest Node.js release the helper supports: the oldest Node.js release still maintained upstream. */
export const MINIMUM_NODE = 20

async function main(): Promise<void> {
  const major = Number.parseInt(process.versions.node, 10)
  if (!(major >= MINIMUM_NODE)) {
    throw new Error(
      `The Projections TypeScript helper requires Node.js ${MINIMUM_NODE} or newer; \`node\` on PATH is ${process.version}. Use the Node.js version the project's own build uses.`,
    )
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > 2 * 1024 * 1024) throw new Error('Extractor request exceeds 2 MiB')
    chunks.push(bytes)
  }
  const input = record(parseJson(Buffer.concat(chunks).toString('utf8')), 'Extractor request')
  if (input.protocolVersion !== 0) throw new Error('Unsupported extractor request protocol')
  const projection = record(input.projection, 'projection')
  const definition = validateDefinition(projection.definition)
  // The extractor comes from the invocation, as for every extractor process: a
  // definition may name it as a built-in or run it through a command.
  const extractor = workerIds.find(id => id === process.argv[2])
  if (extractor === undefined) throw new Error(`The Node extractor helper does not implement ${String(process.argv[2])}`)
  const repository = record(input.repository, 'repository')
  const revision = record(repository.revision, 'repository.revision')
  const capabilities = record(input.capabilities, 'capabilities')
  if (
    projection.id !== definition.id ||
    (repository.mode !== undefined &&
      repository.mode !== 'materialized' &&
      repository.mode !== 'in-place' &&
      repository.mode !== 'workspace') ||
    typeof repository.root !== 'string' ||
    !path.isAbsolute(repository.root) ||
    typeof revision.commit !== 'string' ||
    (revision.kind !== 'commit' && revision.kind !== 'working-tree') ||
    typeof revision.ref !== 'string' ||
    typeof revision.dirty !== 'boolean' ||
    typeof capabilities.trusted !== 'boolean' ||
    typeof capabilities.network !== 'boolean' ||
    (repository.project !== undefined &&
      (typeof repository.project !== 'string' || path.isAbsolute(repository.project) || repository.project.split(/[\\/]/).includes('..')))
  ) {
    throw new Error('Invalid extractor worker request')
  }
  // The definition's project is the root the helper sees: its paths and inputs are relative to it.
  const root = repository.project ? path.join(repository.root, repository.project) : repository.root
  const request: ExtractorRequest = {
    protocolVersion: 0,
    projection: {id: definition.id, definition},
    repository: {
      mode: repository.mode ?? 'materialized',
      root,
      revision: {commit: revision.commit, kind: revision.kind, ref: revision.ref, dirty: revision.dirty},
    },
    capabilities: {trusted: capabilities.trusted, network: capabilities.network},
  }
  const checkout = process.argv[3]
  if (typeof checkout !== 'string' || !path.isAbsolute(checkout) || !(await stat(checkout)).isDirectory()) {
    throw new Error('Usage: extractor.mjs <extractor> <absolute repository checkout>')
  }
  const toolchain = {checkout: await realpath(checkout)}
  const extraction = await collectBuiltin({
    extractor,
    input: request,
    files: request.repository.mode === 'materialized' ? await files(root) : await listed(root),
    toolchain,
  })
  // Decoding, normalization and hashing belong solely to the native CLI's Engine.
  // Application code an extractor loads may leave timers or sockets open; the
  // extraction is complete once it is written.
  process.stdout.write(JSON.stringify(extraction), () => process.exit(0))
}

main().catch((error: unknown) => {
  // Loaded application code may hold the process open; the failure is final once reported.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1))
})
