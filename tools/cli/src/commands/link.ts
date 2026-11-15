// `link` and `unlink`: the optional `projections-tools` command on PATH, which runs this repository's tools from
// anywhere. A launcher script rather than a symlink or `npm link`: it picks the checkout and its pinned Node at run time.
import {chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {TOOLS} from '../lib/invocation.ts'
import {canonical, defaultBinDir, firstOnPath, fromInvocation, onPathList} from '../lib/install.ts'
import {currentHost, findNode, isCheckout, launcherText, linkFileName, readLauncher, type Host} from '../lib/link.ts'
import type {Finding} from './doctor.ts'
import {UsageError} from './work/change-set.ts'

export type LinkOptions = {binDir?: string | undefined; dryRun: boolean}

/** The file at `path`: its text, `undefined` when there is none, or `null` when it isn't a regular file. */
function existing(path: string): string | undefined | null {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return undefined
  }
  return stat.isFile() ? readFileSync(path, 'utf8') : null
}

function linkPath(options: LinkOptions, host: Host) {
  const binDir = options.binDir === undefined ? defaultBinDir(host.home) : fromInvocation(options.binDir)
  return {binDir, path: join(binDir, linkFileName(host.platform))}
}

const foreign = (path: string) =>
  new UsageError(`${path} exists and wasn't written by tools link`, 'Remove it yourself, or pass --bin-dir to link elsewhere')

/** PATH problems with a link at `path`: its directory isn't on PATH, or another `projections-tools` comes first. */
function pathWarnings(binDir: string, path: string, host: Host): {warnings: string[]; next: string[]} {
  const name = linkFileName(host.platform)
  if (!onPathList(binDir, host.env['PATH'] ?? ''))
    return {warnings: [`${binDir} is not on PATH`], next: [`Add it to PATH in your shell profile: export PATH="${binDir}:$PATH"`]}
  const first = firstOnPath(name, host.env['PATH'] ?? '')
  if (first && canonical(first) !== canonical(path))
    return {warnings: [`${first} comes first on PATH and shadows ${path}; remove it or reorder PATH`], next: []}
  return {warnings: [], next: []}
}

export function linkReport(root: string, options: LinkOptions, host: Host = currentHost()) {
  const checkout = canonical(root)
  const {binDir, path} = linkPath(options, host)
  const node = findNode(checkout, host)
  const text = launcherText(path, {checkout, node: node.path}, host.platform)
  const warnings: string[] = []
  const before = existing(path)
  const current = before === null ? ({kind: 'foreign'} as const) : readLauncher(before)
  if (current.kind === 'foreign') throw foreign(path)
  if (!node.matched)
    warnings.push(`Node ${node.pinned} (.node-version) isn't installed; the link runs Node ${node.version} until it is (link again then)`)
  if (current.kind === 'launcher' && current.checkout !== checkout) warnings.push(`Replaces the link to ${current.checkout}`)
  const unchanged = before === text
  if (!options.dryRun && !unchanged) {
    mkdirSync(binDir, {recursive: true})
    writeFileSync(path, text)
    if (host.platform !== 'win32') chmodSync(path, 0o755)
  }
  const onPath = pathWarnings(binDir, path, host)
  warnings.push(...onPath.warnings)
  return {
    status: options.dryRun ? ('planned' as const) : unchanged ? ('unchanged' as const) : ('linked' as const),
    path,
    checkout,
    node: {path: node.path, version: node.version},
    resolution:
      'Inside a Projections checkout (or a repository that holds one in a subdirectory) it runs that checkout’s tools; anywhere else it runs this one’s, and says so on stderr.',
    warnings,
    next: [...onPath.next, 'projections-tools context', 'projections-tools mcp add   # registers it by its absolute path'],
  }
}

export function unlinkReport(options: LinkOptions, host: Host = currentHost()) {
  const {path} = linkPath(options, host)
  const before = existing(path)
  const current = before === null ? ({kind: 'foreign'} as const) : readLauncher(before)
  if (current.kind === 'foreign') throw foreign(path)
  if (current.kind === 'absent') return {status: 'absent' as const, path, next: []}
  if (!options.dryRun) rmSync(path)
  return {
    status: options.dryRun ? ('planned' as const) : ('unlinked' as const),
    path,
    checkout: current.checkout,
    next: ['npm run tools -- link   # in a checkout, to link it again'],
  }
}

/** `doctor`'s view of the link: absent (fine, it's optional), someone else's, stale, or which checkout it runs. */
export function linkFindings(root: string, host: Host = currentHost()): Finding[] {
  const name = linkFileName(host.platform)
  const atDefault = join(defaultBinDir(host.home), name)
  const path = existing(atDefault) !== undefined ? atDefault : (firstOnPath(name, host.env['PATH'] ?? '') ?? atDefault)
  const before = existing(path)
  const current = before === null ? ({kind: 'foreign'} as const) : readLauncher(before)
  const check = 'projections-tools'
  if (current.kind === 'absent')
    return [{check, status: 'ok', detail: `not linked (optional: ${TOOLS} link puts projections-tools on PATH)`}]
  if (current.kind === 'foreign')
    return [{check, status: 'warn', detail: `${path} exists but wasn't written by tools link`, fix: 'remove it, or link with --bin-dir'}]
  if (!isCheckout(current.checkout))
    return [
      {
        check,
        status: 'warn',
        detail: `${path} links to ${current.checkout}, which is no longer a Projections checkout (moved or deleted)`,
        fix: `${TOOLS} link (from the checkout to link), or ${TOOLS} unlink`,
      },
    ]
  const findings: Finding[] = []
  const here = canonical(root) === current.checkout
  findings.push({
    check,
    status: 'ok',
    detail: `${path} links ${here ? 'this checkout' : `${current.checkout}; inside this checkout it runs this checkout's tools`}`,
  })
  if (!existsSync(current.node))
    findings.push({
      check,
      status: 'warn',
      detail: `its Node ${current.node} no longer exists; it runs node from PATH`,
      fix: `${TOOLS} link`,
    })
  const onPath = pathWarnings(dirname(path), path, host)
  findings.push(
    ...onPath.warnings.map(warning => ({
      check,
      status: 'warn' as const,
      detail: warning,
      ...(onPath.next[0] ? {fix: onPath.next[0]} : {}),
    })),
  )
  return findings
}
