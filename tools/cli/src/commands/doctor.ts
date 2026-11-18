// `doctor`: is this machine ready to build and test the repository?
import {existsSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {buildState} from '../lib/builds.ts'
import {TOOLS} from '../lib/gates.ts'
import {cliBinary} from '../lib/needs.ts'
import {linkFindings} from './link.ts'
import {loadUnits} from '../lib/packages.ts'
import {newestMtime, onPath, probe, readText, type Command} from '../lib/repo.ts'
import {availableMemory, gigabytes, playwrightBrowsers} from '../lib/machine.ts'
import {nightly, toolchains, type Status} from '../lib/toolchains.ts'

export type Finding = {check: string; status: Status; detail: string; fix?: string}

const PUBLIC_REGISTRY = /registry\.npmjs\.org|registry\.yarnpkg\.com/

/** The registry `.npmrc` configures, and the one npm actually resolves here (environment overrides included). */
export function registryFindings(root: string, resolved: string | undefined): Finding[] {
  const configured = /^registry\s*=\s*(\S+)/m.exec(readText(root, '.npmrc') ?? '')?.[1]
  const findings: Finding[] = []
  if (!configured)
    findings.push({check: 'registry', status: 'fail', detail: '.npmrc configures no registry', fix: 'restore the committed .npmrc'})
  else if (PUBLIC_REGISTRY.test(configured))
    findings.push({
      check: 'registry',
      status: 'fail',
      detail: `.npmrc points at the public registry (${configured})`,
      fix: 'restore the committed .npmrc',
    })
  const normalize = (url: string | undefined) => url?.replace(/\/?$/, '/')
  if (resolved === undefined) findings.push({check: 'registry', status: 'warn', detail: 'could not ask npm for its registry'})
  else if (PUBLIC_REGISTRY.test(resolved))
    findings.push({
      check: 'registry',
      status: 'fail',
      detail: `npm resolves ${resolved}; installs would contact the public registry`,
      fix: 'unset npm_config_registry / NPM_CONFIG_REGISTRY and any user .npmrc registry override',
    })
  else if (configured && normalize(resolved) !== normalize(configured))
    findings.push({
      check: 'registry',
      status: 'warn',
      detail: `npm resolves ${resolved}, not .npmrc's ${configured}`,
      fix: 'unset the overriding npm_config_registry',
    })
  else if (configured) findings.push({check: 'registry', status: 'ok', detail: `npm resolves ${resolved}`})
  return findings
}

/** Rust sources and manifests, whose changes the built CLI doesn't have yet. */
function rustSourcesNewest(root: string) {
  const units = loadUnits(root).filter(unit => unit.kinds.includes('crate'))
  let newest: {path: string; mtime: number} | undefined
  for (const unit of units) {
    const candidate = newestMtime(root, unit.path, path => /\.(rs|toml)$/.test(path))
    if (candidate && (!newest || candidate.mtime > newest.mtime)) newest = candidate
  }
  return newest
}

export function buildFindings(root: string): Finding[] {
  const findings: Finding[] = []
  const binary = join(root, cliBinary)
  if (!existsSync(binary)) findings.push({check: 'cli build', status: 'warn', detail: `${cliBinary} is not built`, fix: 'npm run build'})
  else {
    const built = statSync(binary).mtimeMs
    const newest = rustSourcesNewest(root)
    findings.push(
      newest && newest.mtime > built
        ? {
            check: 'cli build',
            status: 'warn',
            detail: `${cliBinary} is older than ${newest.path}`,
            fix: 'npm run build --workspace @githubnext/projections-cli',
          }
        : {check: 'cli build', status: 'ok', detail: `${cliBinary} is newer than the Rust sources`},
    )
  }
  const stale: string[] = []
  const unbuilt: string[] = []
  for (const unit of loadUnits(root)) {
    const state = buildState(root, unit)
    if (state === 'unbuilt') unbuilt.push(unit.path)
    else if (state === 'stale' || state === 'incomplete') stale.push(unit.path)
  }
  if (stale.length)
    findings.push({
      check: 'workspace builds',
      status: 'warn',
      detail: `dist older than src in ${stale.join(', ')}`,
      fix: `${TOOLS} build ${stale[0]}, or npm run build`,
    })
  if (unbuilt.length)
    findings.push({
      check: 'workspace builds',
      status: 'warn',
      detail: `${unbuilt.length} workspaces not built (${unbuilt.slice(0, 4).join(', ')}${unbuilt.length > 4 ? ', …' : ''})`,
      fix: 'npm run build',
    })
  if (!stale.length && !unbuilt.length)
    findings.push({check: 'workspace builds', status: 'ok', detail: 'every built workspace is newer than its src'})
  return findings
}

export function doctorReport(root: string) {
  const findings: Finding[] = []
  for (const tool of toolchains(root, {optional: true})) {
    findings.push({
      check: `toolchain ${tool.name}`,
      status: tool.status,
      detail: `${tool.installed ?? 'missing'}${tool.required ? ` (requires ${tool.required})` : ''}${tool.optional ? '; optional, for the native extractor suites' : ''}`,
      ...(tool.status === 'ok'
        ? {}
        : {
            fix:
              tool.name === 'node'
                ? 'use the Node version in .node-version'
                : tool.name === 'rust'
                  ? 'rustup toolchain install (in this directory)'
                  : `install ${tool.name} ${tool.required ?? ''}`.trim(),
          }),
    })
  }
  const night = nightly(root)
  if (night.name) {
    findings.push(
      night.installed
        ? {check: 'docs nightly', status: 'ok', detail: `${night.name} (for docs:check)`}
        : {
            check: 'docs nightly',
            status: 'warn',
            detail: `${night.name} not installed; tools check skips the docs gate`,
            fix: `rustup toolchain install ${night.name} --profile minimal`,
          },
    )
  }
  const considered = probe(root, ['node', 'tools/scripts/considered.mjs', '--where'])
  findings.push(
    considered
      ? {check: 'considered', status: 'ok', detail: `${considered} (for check:considered)`}
      : {
          check: 'considered',
          status: 'warn',
          detail: 'the pinned considered is not installed; the considered gate fails',
          fix: 'node tools/scripts/considered.mjs install',
        },
  )
  const lock = join(root, 'node_modules/.package-lock.json')
  if (!existsSync(lock)) findings.push({check: 'dependencies', status: 'fail', detail: 'node_modules is not installed', fix: 'npm ci'})
  else if (statSync(join(root, 'package-lock.json')).mtimeMs > statSync(lock).mtimeMs + 1000)
    findings.push({check: 'dependencies', status: 'warn', detail: 'package-lock.json changed since the last install', fix: 'npm ci'})
  else findings.push({check: 'dependencies', status: 'ok', detail: 'node_modules matches package-lock.json; npm ci is not needed'})
  findings.push(...registryFindings(root, probe(root, ['npm', 'config', 'get', 'registry'])))
  findings.push(...buildFindings(root))
  const browsers = playwrightBrowsers(root)
  if (browsers) {
    const missing = browsers.filter(browser => !browser.installed)
    findings.push(
      missing.length
        ? {
            check: 'playwright browsers',
            status: 'warn',
            detail: `${missing.map(browser => `${browser.name} ${browser.revision}`).join(', ')} not installed; browser suites can't run`,
            fix: `npx playwright install ${missing.map(browser => browser.name).join(' ')}`,
          }
        : {check: 'playwright browsers', status: 'ok', detail: browsers.map(browser => `${browser.name} ${browser.revision}`).join(', ')},
    )
  }
  const memory = availableMemory()
  findings.push(
    memory.available < 4 * 1024 ** 3
      ? {
          check: 'memory',
          status: 'warn',
          detail: `${gigabytes(memory.available)} available of ${gigabytes(memory.total)}; browser suites may thrash`,
          fix: 'close other browser suites; tools test --browser runs one project with 2 workers',
        }
      : {check: 'memory', status: 'ok', detail: `${gigabytes(memory.available)} available of ${gigabytes(memory.total)}`},
  )
  const gh = onPath('gh')
  findings.push(
    gh
      ? probe(root, ['gh', 'auth', 'status']) !== undefined
        ? {check: 'gh', status: 'ok', detail: 'installed and authenticated (tools feedback --submit can file issues)'}
        : {
            check: 'gh',
            status: 'warn',
            detail: 'installed but not authenticated; tools feedback --submit falls back to a URL',
            fix: 'gh auth login',
          }
      : {check: 'gh', status: 'warn', detail: 'not installed; tools feedback --submit falls back to a URL'},
  )
  findings.push(...linkFindings(root))
  const status: Status = findings.some(finding => finding.status === 'fail')
    ? 'fail'
    : findings.some(finding => finding.status === 'warn')
      ? 'warn'
      : 'ok'
  const fixes = findings.filter(finding => finding.status === 'fail' && finding.fix).map(finding => finding.fix as string)
  return {status, findings, next: fixes.length ? fixes : [`${TOOLS} context`]}
}

export type {Command}
