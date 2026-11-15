// `install`: builds this checkout and installs it for early access, without waiting for a registry or the Marketplace:
// the `projections` CLI linked onto PATH, the VS Code extension (with that CLI inside) and `@githubnext/projections`
// packed to a fixed path that renderer projects reference with `file:`.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {TOOLS} from '../lib/gates.ts'
import {
  canonical,
  defaultBinDir,
  devVersion,
  EXTENSION_ID,
  findEditor,
  firstOnPath,
  fromInvocation,
  onPathList,
  PACKAGE,
  parts,
  pointAtTarball,
  TARBALL,
  tarballSpec,
  VSIX,
  vsceTarget,
  withoutNpmConfig,
  type Editor,
  type Part,
} from '../lib/install.ts'
import {cliBinary} from '../lib/needs.ts'
import {inDependencyOrder, loadUnits} from '../lib/packages.ts'
import {tail} from '../lib/problems.ts'
import {display, git, probe, readJson, readText, run, type Command} from '../lib/repo.ts'
import {doctorReport} from './doctor.ts'
import {split, UsageError} from './work/change-set.ts'

/** vsce, run with npx through the committed registry rather than added as a dependency (see packages/integrations/vscode/README.md). */
export const VSCE = '@vscode/vsce@4.1.0'

/** A toolchain or other prerequisite is missing: exit code 3. */
export class PrerequisiteError extends Error {
  hint: string | undefined
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
  }
}

export type InstallOptions = {
  only?: string[] | undefined
  project?: string | undefined
  binDir?: string | undefined
  editor: Editor
  extensionsDir?: string | undefined
  userDataDir?: string | undefined
  dryRun: boolean
  skipBuild: boolean
}

type StepStatus = 'ran' | 'skip' | 'planned' | 'failed'
type Step = {step: string; status: StepStatus; detail: string; commands?: string[]; seconds?: number; tail?: string[]}
type Installed = {part: string; path: string; version?: string}
/** A step's work: a command, or something done in this process (described for --dry-run when worth showing). */
type Work = Command | {describe?: string; act: () => void}

export function selectParts(only: readonly string[] | undefined): Part[] {
  const wanted = split(only)
  const unknown = wanted.filter(part => !(parts as readonly string[]).includes(part))
  if (unknown.length) throw new UsageError(`Unknown part ${unknown.join(', ')}`, `--only takes ${parts.join(', ')}`)
  return wanted.length ? parts.filter(part => wanted.includes(part)) : [...parts]
}

/** The workspaces `@githubnext/projections` is built from, in dependency order. */
function packageBuildOrder(root: string): string[] {
  const units = loadUnits(root)
  const byPath = new Map(units.map(unit => [unit.path, unit]))
  const closure = new Set<string>()
  const visit = (path: string) => {
    if (closure.has(path)) return
    closure.add(path)
    for (const dependency of byPath.get(path)?.dependsOn ?? []) visit(dependency)
  }
  visit('packages/sdk')
  return inDependencyOrder(units, closure).filter(path => {
    const unit = byPath.get(path)
    return unit?.kinds.includes('npm') && unit.scripts.includes('build')
  })
}

/** Links (or on Windows, a `.cmd` shim) `name` in `directory` to `binary`. Refuses to replace a file it didn't make. */
function linkCli(binary: string, directory: string): {path: string; previous?: string} {
  mkdirSync(directory, {recursive: true})
  if (process.platform === 'win32') {
    const path = join(directory, 'projections.cmd')
    const marker = 'rem projections: npm run tools -- install'
    // Shims written before the CLI was renamed from `dev` carry the old marker.
    const markers = [marker, 'rem projections: npm run dev -- install']
    const existing = readText(directory, 'projections.cmd')
    if (existing !== undefined && !markers.some(known => existing.includes(known)))
      throw new UsageError(`${path} exists and wasn't made by tools install`, 'Remove it, or pass --bin-dir')
    writeFileSync(path, `@echo off\r\n${marker}\r\n"${binary}" %*\r\n`)
    return {path}
  }
  const path = join(directory, 'projections')
  let previous: string | undefined
  let existing
  try {
    existing = lstatSync(path)
  } catch {
    existing = undefined
  }
  if (existing && !existing.isSymbolicLink())
    throw new UsageError(`${path} exists and is not a symlink`, 'Remove it (an earlier install?), or pass --bin-dir')
  if (existing) {
    previous = readlinkSync(path)
    rmSync(path)
  }
  symlinkSync(binary, path)
  return previous && previous !== binary ? {path, previous} : {path}
}

/** Rewrites a manifest, keeping its indentation and final newline. */
function writeManifest(path: string, text: string, manifest: unknown) {
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '
  writeFileSync(path, `${JSON.stringify(manifest, null, indent)}${text.endsWith('\n') ? '\n' : ''}`)
}

export async function installReport(root: string, options: InstallOptions, progress?: (line: string) => void, echo = false) {
  const selected = selectParts(options.only)
  const project = options.project === undefined ? undefined : fromInvocation(options.project)
  if (project && !existsSync(join(project, 'package.json')))
    throw new UsageError(`${project} has no package.json`, `--project names the renderer package that depends on ${PACKAGE}`)
  if (project && !selected.includes('npm') && !existsSync(join(root, TARBALL)) && !options.dryRun)
    throw new UsageError(`--project needs ${TARBALL}, which isn't packed yet`, 'Include npm in --only')
  const binDir = options.binDir === undefined ? defaultBinDir() : fromInvocation(options.binDir)
  const needsCli = selected.includes('cli') || selected.includes('vscode')
  const steps: Step[] = []
  const installed: Installed[] = []
  const warnings: string[] = []
  const next: string[] = []
  const commit = git(root, ['rev-parse', '--short=7', 'HEAD']) ?? 'unknown'
  const dirty = Boolean(git(root, ['status', '--porcelain=v1', '--', '.']))
  const now = new Date()
  const say = (line: string) => progress?.(line)

  let failed = false
  /** Runs one step's commands (or plans them), recording the step; false when it failed. */
  const perform = async (step: string, detail: string, work: Work[]): Promise<boolean> => {
    const commands = work.map(item => ('act' in item ? item.describe : display(item))).filter((line): line is string => line !== undefined)
    if (options.dryRun) {
      steps.push({step, status: 'planned', detail, ...(commands.length ? {commands} : {})})
      return true
    }
    say(`▸ ${step}: ${detail}`)
    const started = Date.now()
    for (const item of work) {
      if ('act' in item) {
        try {
          item.act()
        } catch (error) {
          if (error instanceof UsageError) throw error
          steps.push({step, status: 'failed', detail: (error as Error).message, seconds: Math.round((Date.now() - started) / 1000)})
          failed = true
          return false
        }
        continue
      }
      say(`  $ ${display(item)}`)
      const result = await run(root, item, {echo})
      if (result.exitCode !== 0) {
        steps.push({
          step,
          status: 'failed',
          detail: result.missing ? `${result.missing} is not installed` : `${result.command} exited ${result.exitCode}`,
          commands,
          seconds: Math.round((Date.now() - started) / 1000),
          tail: tail(result.output, 15),
        })
        failed = true
        return false
      }
    }
    steps.push({step, status: 'ran', detail, ...(commands.length ? {commands} : {}), seconds: Math.round((Date.now() - started) / 1000)})
    return true
  }
  const skip = (step: string, detail: string) => steps.push({step, status: 'skip', detail})

  // ── doctor ──
  const doctor = doctorReport(root)
  const blocking = doctor.findings.filter(
    finding => finding.status === 'fail' && finding.check !== 'dependencies' && (needsCli || finding.check !== 'toolchain rust'),
  )
  if (blocking.length) {
    const lines = blocking.map(finding => `${finding.check}: ${finding.detail}${finding.fix ? ` (fix: ${finding.fix})` : ''}`)
    if (!options.dryRun)
      throw new PrerequisiteError(
        `This machine can't build Projections yet:\n  ${lines.join('\n  ')}`,
        `Fix these, then run ${TOOLS} install again (${TOOLS} doctor for everything).`,
      )
    steps.push({step: 'doctor', status: 'failed', detail: lines.join('; ')})
    failed = true
  } else steps.push({step: 'doctor', status: 'ran', detail: `toolchains ready (${doctor.status})`})

  // ── dependencies and build ──
  const lock = join(root, 'node_modules/.package-lock.json')
  const stale = !existsSync(lock) || statSync(join(root, 'package-lock.json')).mtimeMs > statSync(lock).mtimeMs + 1000
  if (stale)
    await perform('dependencies', 'package-lock.json changed since the last install', [{argv: ['npm', 'ci', '--no-audit', '--no-fund']}])
  else skip('dependencies', 'node_modules matches package-lock.json')

  if (!failed) {
    if (options.skipBuild) skip('build', '--skip-build: using the existing build')
    else if (needsCli)
      // Everything the CLI embeds (Inspector, renderers, comparators, helpers), the extension and the package: the
      // whole workspace except Storybook, in dependency order; the CLI is a release build (packages/cli/scripts/build.mjs).
      await perform('build', 'the workspaces (except Storybook) and a release build of the CLI', [
        {argv: ['npm', 'run', 'build', '--', '--except', 'tools/storybook']},
      ])
    else {
      const order = packageBuildOrder(root)
      await perform(
        'build',
        `${PACKAGE} and the ${order.length - 1} workspaces it is built from`,
        order.map(path => ({argv: ['npm', 'run', 'build', '--workspace', path]})),
      )
    }
  }

  const binary = join(root, cliBinary)
  const cliVersion = () => probe(root, [binary, '--version'])?.replace(/^projections\s+/, '')

  // ── cli ──
  if (!failed && selected.includes('cli')) {
    let linked: {path: string; previous?: string} | undefined
    const ok = await perform('cli', `link ${binDir}/projections to ${cliBinary}`, [
      {
        describe: `ln -sf ${binary} ${join(binDir, 'projections')}`,
        act: () => {
          if (!existsSync(binary)) throw new Error(`${cliBinary} is not built`)
          linked = linkCli(binary, binDir)
        },
      },
    ])
    if (ok && options.dryRun) next.push('projections --version')
    if (ok && linked) {
      installed.push({part: 'cli', path: linked.path, ...(cliVersion() ? {version: cliVersion() as string} : {})})
      if (linked.previous) warnings.push(`Replaced ${linked.path}, which linked to ${linked.previous}`)
      if (!onPathList(binDir)) {
        warnings.push(`${binDir} is not on PATH`)
        next.push(`Add it to PATH in your shell profile: export PATH="${binDir}:$PATH"`)
      } else {
        const first = firstOnPath(process.platform === 'win32' ? 'projections.cmd' : 'projections')
        if (first && canonical(first) !== canonical(binary) && first !== linked.path)
          warnings.push(`${first} comes first on PATH and shadows ${linked.path}; remove it or reorder PATH`)
      }
      next.push('projections --version')
    }
  }

  // ── vscode ──
  if (!failed && selected.includes('vscode')) {
    const target = vsceTarget()
    const manifest = readJson<{version: string}>(root, 'packages/integrations/vscode/package.json')
    const registry = /^registry\s*=\s*(\S+)/m.exec(readText(root, '.npmrc') ?? '')?.[1]
    if (!target) {
      steps.push({step: 'vscode', status: 'failed', detail: `VS Code has no platform package for ${process.platform}-${process.arch}`})
      failed = true
    } else if (!manifest || !registry) {
      steps.push({step: 'vscode', status: 'failed', detail: 'packages/integrations/vscode/package.json or the .npmrc registry is missing'})
      failed = true
    } else {
      const version = devVersion(manifest.version, commit, dirty, now)
      const staging = join(root, 'dist/dogfood/vscode')
      const vsix = join(root, VSIX)
      const packaged = await perform('vscode package', `${EXTENSION_ID} ${version} for ${target}, with this CLI inside`, [
        {
          act: () => {
            if (!existsSync(binary)) throw new Error(`${cliBinary} is not built`)
            mkdirSync(dirname(vsix), {recursive: true})
            rmSync(vsix, {force: true})
          },
        },
        {
          argv: [
            'node',
            'packages/integrations/vscode/scripts/package.mjs',
            '--target',
            target,
            '--binary',
            cliBinary,
            '--version',
            version,
            '--out',
            'dist/dogfood/vscode',
          ],
        },
        // The staged directory has its own package.json, so npm wouldn't read the workspace's .npmrc there.
        {
          argv: ['npx', '--yes', VSCE, 'package', '--target', target, '--no-dependencies', '--out', vsix],
          cwd: join(staging, target),
          env: {npm_config_registry: registry},
        },
      ])
      if (packaged) {
        if (!options.dryRun) installed.push({part: 'vscode package', path: VSIX, version})
        const editor = findEditor(options.editor)
        if (!editor) {
          skip(
            'vscode install',
            options.editor === 'none'
              ? '--editor none: packaged only'
              : `no ${options.editor === 'auto' ? 'code or code-insiders' : options.editor} command line found`,
          )
          next.push(`code --install-extension ${vsix} --force   # or code-insiders`)
        } else {
          const argv = [
            editor.path,
            '--install-extension',
            vsix,
            '--force',
            ...(options.extensionsDir ? ['--extensions-dir', fromInvocation(options.extensionsDir)] : []),
            ...(options.userDataDir ? ['--user-data-dir', fromInvocation(options.userDataDir)] : []),
          ]
          const ok = await perform('vscode install', `into ${editor.name}`, [
            {argv: editor.path.endsWith('.cmd') ? ['cmd', '/c', ...argv] : argv},
          ])
          if (ok && !options.dryRun) {
            installed.push({part: `vscode (${editor.name})`, path: EXTENSION_ID, version})
            next.push(`In VS Code: Developer: Reload Window (the extension's CLI is ${cliVersion() ?? 'the one just built'})`)
          }
        }
      }
    }
  }

  // ── npm ──
  if (!failed && selected.includes('npm')) {
    const manifest = readJson<{version: string}>(root, 'packages/sdk/package.json')
    const version = devVersion(manifest?.version ?? '0.0.0', commit, dirty, now)
    const tarball = join(root, TARBALL)
    const staging = options.dryRun ? join(tmpdir(), 'projections-pack-…') : mkdtempSync(join(tmpdir(), 'projections-pack-'))
    const packed = () => readdirSync(staging).find(name => name.endsWith('.tgz')) as string
    const ok = await perform('npm package', `${PACKAGE} ${version} packed to ${TARBALL}`, [
      // npm pack exactly as publishing would, then the same contents again with the development version.
      {argv: ['npm', 'pack', '--ignore-scripts', '--pack-destination', staging], cwd: 'packages/sdk'},
      {
        describe: `tar -xzf ${staging}/<packed>.tgz, then set package/package.json's version to ${version}`,
        act: () => {
          const first = packed()
          if (!first) throw new Error('npm pack wrote no tarball')
          if (probe(staging, ['tar', '-xzf', first, '-C', staging]) === undefined) throw new Error(`tar could not extract ${first}`)
          rmSync(join(staging, first))
          const path = join(staging, 'package/package.json')
          const text = readFileSync(path, 'utf8')
          writeManifest(path, text, {...JSON.parse(text), version})
        },
      },
      {argv: ['npm', 'pack', '--ignore-scripts', '--pack-destination', staging], cwd: join(staging, 'package')},
      {
        describe: `copy it to ${TARBALL}`,
        act: () => {
          mkdirSync(dirname(tarball), {recursive: true})
          copyFileSync(join(staging, packed()), tarball)
        },
      },
    ])
    if (!options.dryRun) rmSync(staging, {recursive: true, force: true})
    if (ok && !options.dryRun) installed.push({part: 'npm package', path: TARBALL, version})
    if (ok && !project) next.push(`${TOOLS} install --only npm --project <renderer package directory>   # point a renderer at it`)
  }

  // ── project ──
  if (!failed && project) {
    const spec = tarballSpec(project, join(root, TARBALL))
    let changes: string[] = []
    const ok = await perform('project', `${project}: ${PACKAGE} from ${spec}`, [
      {
        describe: `point package.json's ${PACKAGE} at ${spec}, removing a conflicting override`,
        act: () => {
          const path = join(project, 'package.json')
          const text = readFileSync(path, 'utf8')
          const result = pointAtTarball(JSON.parse(text), spec, project)
          changes = result.changes
          if (changes.length) writeManifest(path, text, result.manifest)
        },
      },
      // The project's own npm configuration (its .npmrc, the user's), not this workspace's.
      {
        argv: ['npm', 'install', '--no-audit', '--no-fund', `${PACKAGE}@${spec}`],
        cwd: project,
        env: withoutNpmConfig(process.env),
        replaceEnv: true,
      },
    ])
    if (ok && !options.dryRun) {
      installed.push({part: 'project', path: project, version: `${PACKAGE}@${spec}`})
      if (changes.length) warnings.push(...changes.map(change => `package.json ${change}`))
      next.push(`cd ${project} && npm run build`)
    }
  }

  if (!failed && !options.dryRun)
    next.push(`To update: git pull && npm ci && ${TOOLS} install${options.only ? ` --only ${split(options.only).join(',')}` : ''}`)
  return {
    status: failed ? ('fail' as const) : options.dryRun ? ('planned' as const) : ('ok' as const),
    build: {commit, dirty},
    steps,
    installed,
    warnings,
    next,
  }
}
