// The repository's gates, as `npm run check` and CI run them, and a runner that summarises each one.
import type {Affected} from './affected.ts'
import {TOOLS} from './invocation.ts'
import {cliBinary, unmet} from './needs.ts'
import {linkProblems} from './links.ts'
import {inDependencyOrder, readmeProblems, type Unit} from './packages.ts'
import {parseConsidered, parseFormatCheck, parseProblems, parseStalePages, tail, type Problem} from './problems.ts'
import {display, run, type Command} from './repo.ts'
import {changedFiles, fastTypecheck, lintPlan, npm, npx} from './typed-gates.ts'
import {versionProblems} from './release-check.ts'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

export {TOOLS}

export interface GateContext {
  root: string
  units: readonly Unit[]
  affected?: Affected | undefined
  files?: readonly string[] | undefined
  /** `check --fast`: only what changed, without building it or its dependants. */
  fast?: boolean | undefined
}

/** Commands to run (`note` says what they leave out), a reason to skip, or a check done in process. */
export type Plan = {commands: Command[]; note?: string} | {skip: string} | {internal: () => Problem[]}

export interface Gate {
  name: string
  description: string
  /** Gates that must pass first. */
  after?: string[]
  /** Run only when asked for (`--only`, or a flag). */
  optional?: boolean
  /** Cheap: part of `check --fast`, which builds and tests nothing. */
  fast?: boolean
  plan: (context: GateContext) => Plan
  parse?: (output: string, root: string) => Problem[]
  /** The command that fixes this gate's failures, when one does. */
  fix?: string
}

/** Workspaces the change touches (changed and dependants) with `script`, in dependency order. */
function affectedWorkspaces(context: GateContext, script: string): Unit[] {
  const affected = context.affected
  if (!affected) return []
  const paths = inDependencyOrder(context.units, [...affected.changed, ...affected.dependants])
  return paths
    .map(path => context.units.find(unit => unit.path === path)!)
    .filter(unit => unit.kinds.includes('npm') && unit.scripts.includes(script))
}

function workspaceCommands(context: GateContext, script: string): Plan {
  const units = affectedWorkspaces(context, script)
  return units.length
    ? {commands: units.map(unit => npm('run', script, '--workspace', unit.names[0]!))}
    : {skip: `no affected workspace has a ${script} script`}
}

const affectedCrates = (context: GateContext, changedOnly = false) =>
  context.units
    .filter(
      unit =>
        unit.kinds.includes('crate') &&
        [...(context.affected?.changed ?? []), ...(changedOnly ? [] : (context.affected?.dependants ?? []))].includes(unit.path),
    )
    .map(unit => unit.names.at(-1)!)

export const gates: Gate[] = [
  {
    name: 'boundaries',
    fast: true,
    description: 'Dependency and import boundaries (npm run check:boundaries)',
    plan: () => ({commands: [npm('run', '--silent', 'check:boundaries')]}),
  },
  {
    name: 'casing',
    fast: true,
    description: 'No style recases text: data verbatim, human text in sentence case (npm run check:casing)',
    plan: () => ({commands: [npm('run', '--silent', 'check:casing')]}),
  },
  {
    name: 'portability',
    fast: true,
    description: 'Shipped code makes no operating-system assumptions beyond .portability.yaml (npm run check:portability)',
    plan: () => ({commands: [npm('run', '--silent', 'check:portability')]}),
  },
  {
    name: 'icons',
    fast: true,
    description: 'The product icons and their generated outputs are current (npm run check:icons)',
    plan: () => ({commands: [npm('run', '--silent', 'check:icons')]}),
    fix: 'npm run icons',
  },
  {
    name: 'considered',
    fast: true,
    description: 'File size, line length, code lines and complexity against .considered.yaml (npm run check:considered)',
    plan: () => ({commands: [{argv: ['node', 'tools/scripts/considered.mjs', 'check', '--json']}]}),
    parse: (output, root) => {
      const violations = parseConsidered(output)
      return violations.length ? violations : parseProblems(output, root)
    },
  },
  {
    name: 'machines',
    fast: true,
    description:
      'No file gains an implicit lifecycle over its baseline, and every state machine has an explore test (npm run check:machines)',
    plan: () => ({commands: [npm('run', '--silent', 'check:machines')]}),
    fix: 'node tools/scripts/check-machines.mjs --update',
  },
  {
    name: 'tsdoc',
    description: 'Every public TypeScript symbol has a documentation comment (npm run check:tsdoc)',
    plan: context =>
      context.affected && !context.affected.kinds.some(kind => kind === 'ts' || kind === 'manifests')
        ? {skip: 'no TypeScript or manifest changed'}
        : {commands: [npm('run', '--silent', 'check:tsdoc')]},
  },
  {
    name: 'lockfile',
    fast: true,
    description: 'Lockfile registry URLs (npm run check:lockfile)',
    plan: context =>
      context.affected && !context.affected.kinds.includes('manifests')
        ? {skip: 'no manifest changed'}
        : {commands: [npm('run', '--silent', 'check:lockfile')]},
    fix: 'node tools/scripts/lockfile-registry.mjs --fix',
  },
  {
    name: 'readmes',
    fast: true,
    description: 'Every workspace and crate README has a front matter description (npm run check:readmes)',
    plan: context => ({internal: () => readmeProblems(context.units)}),
  },
  {
    name: 'links',
    fast: true,
    description: 'Relative Markdown links and anchors resolve, and docs/ pages named in source exist (npm run check:links)',
    plan: context => ({internal: () => linkProblems(context.root)}),
  },
  {
    name: 'versions',
    fast: true,
    description:
      'Every shipped manifest, their dependencies on each other and both lockfiles carry the release version (npm run check:versions)',
    plan: context => ({internal: () => versionProblems(context.root).map(({file, line, message}) => ({file, line, message}))}),
    fix: `${TOOLS} version <version>`,
  },
  {
    name: 'format',
    fast: true,
    description: 'Formatting (oxfmt --check)',
    plan: context => {
      if (!context.affected) return {commands: [npx('oxfmt', '--check')]}
      const files = changedFiles(context, /\.([cm]?[jt]sx?|json|jsonc|ya?ml|css|html|toml)$/u)
      return files.length
        ? {commands: [npx('oxfmt', '--check', '--no-error-on-unmatched-pattern', ...files)]}
        : {skip: 'no formattable file changed'}
    },
    parse: parseFormatCheck,
    fix: `${TOOLS} fix --only format`,
  },
  {
    name: 'cargo-fmt',
    fast: true,
    description: 'Rust formatting (cargo fmt --check)',
    plan: context =>
      context.affected && !context.affected.kinds.includes('rust')
        ? {skip: 'no Rust changed'}
        : {commands: [{argv: ['cargo', 'fmt', '--all', '--', '--check']}]},
    fix: `${TOOLS} fix --only cargo-fmt`,
  },
  {
    name: 'build',
    description: 'Build every workspace in dependency order (npm run build)',
    plan: context => (context.affected ? workspaceCommands(context, 'build') : {commands: [npm('run', 'build')]}),
  },
  {
    name: 'notices',
    description:
      "notices/notices.json covers exactly the locked versions of the crates that ship no license files, and notices/README.md's table is current (npm run check:notices)",
    // The build fetches the crate sources it reads license files from.
    after: ['build'],
    plan: context =>
      context.affected &&
      !context.affected.kinds.includes('rust') &&
      !(context.files ?? []).some(path => /^notices\/|^tools\/scripts\/(?:crate-)?notices\.mjs$|^dist-workspace\.toml$/u.test(path))
        ? {skip: 'no crate, notices or release target changed'}
        : {commands: [npm('run', '--silent', 'check:notices')]},
  },
  {
    name: 'comparators',
    description: 'Comparator files and docs examples against the schema and the rules interpreter (npm run check:comparators)',
    after: ['build'],
    plan: context =>
      context.affected && !context.affected.kinds.some(kind => kind === 'comparators' || kind === 'docs')
        ? {skip: 'no comparator, schema or docs change'}
        : {commands: [npm('run', '--silent', 'check:comparators')]},
  },
  {
    name: 'typecheck',
    fast: true,
    description: 'Unfiltered TypeScript in every workspace (npm run typecheck); with --fast, only the changed workspaces',
    after: ['build'],
    plan: context =>
      context.fast
        ? fastTypecheck(context)
        : context.affected
          ? workspaceCommands(context, 'typecheck')
          : {commands: [npm('run', 'typecheck')]},
  },
  {
    name: 'lint',
    fast: true,
    description: 'ESLint with type information, a process per workspace (npm run lint); with --fast, only the changed files',
    // Type-aware rules read the dependencies' built declarations, as the typecheck does.
    after: ['build'],
    plan: lintPlan,
  },
  {
    name: 'docs',
    description: 'Generated reference pages are current (npm run docs:check)',
    after: ['build'],
    plan: context => {
      if (
        context.affected &&
        !context.affected.regenerate.some(generator => generator.name === 'reference-docs' || generator.name === 'builtin-docs') &&
        !(context.files ?? []).some(path => /^docs\/(?:reference|agents|builtins)\//u.test(path))
      ) {
        return {skip: 'no reference docs source changed'}
      }
      const missing = unmet(context.root, ['nightly'])
      if (missing.length) return {skip: `needs the pinned nightly: ${missing[0]?.fix}`}
      if (!existsSync(join(context.root, cliBinary))) return {skip: 'needs the built CLI: npm run build'}
      return {commands: [npm('run', '--silent', 'docs:check')]}
    },
    parse: (output, root) => [...parseStalePages(output), ...parseProblems(output, root)],
    fix: `${TOOLS} fix --only reference-docs`,
  },
  {
    name: 'cargo-check',
    fast: true,
    description:
      'Rust compiles, tests included (cargo check --all-targets): the changed crates with --fast, the affected ones with --affected',
    optional: true,
    plan: context => {
      if (context.affected && !context.affected.kinds.includes('rust')) return {skip: 'no Rust changed'}
      // The workspace manifest, lockfile and toolchain belong to no crate and affect every one.
      const everything = (context.files ?? []).some(path => /^(?:Cargo\.(?:toml|lock)|rust-toolchain\.toml)$/u.test(path))
      const crates = context.affected && !everything ? affectedCrates(context, context.fast) : []
      if (context.affected && !everything && !crates.length) return {skip: 'no crate changed'}
      return {
        commands: [
          {
            argv: [
              'cargo',
              'check',
              ...(crates.length ? crates.flatMap(crate => ['-p', crate]) : ['--workspace']),
              '--all-targets',
              '--locked',
              '--message-format',
              'short',
            ],
          },
        ],
      }
    },
  },
  {
    name: 'clippy',
    description: 'Clippy with warnings denied (part of npm run test:rust)',
    optional: true,
    plan: context => {
      if (context.affected && !context.affected.kinds.includes('rust')) return {skip: 'no Rust changed'}
      const crates = context.affected ? affectedCrates(context) : []
      return {
        commands: [
          {
            argv: [
              'cargo',
              'clippy',
              ...(crates.length ? crates.flatMap(crate => ['-p', crate]) : ['--workspace']),
              '--all-targets',
              '--locked',
              '--message-format',
              'short',
              '--',
              '-D',
              'warnings',
            ],
          },
        ],
      }
    },
  },
]

export interface GateResult {
  gate: string
  status: 'pass' | 'fail' | 'skip'
  durationMs?: number
  commands?: string[]
  reason?: string
  problems?: Problem[]
  moreProblems?: number
  tail?: string[]
  fix?: string
}

/** Bounds a problem list for output. */
export function bound(problems: readonly Problem[], limit: number): {problems: Problem[]; moreProblems?: number} {
  return problems.length > limit ? {problems: problems.slice(0, limit), moreProblems: problems.length - limit} : {problems: [...problems]}
}

/** A command for display, with long file lists shortened. */
export function abbreviate(command: Command, keep = 4): string {
  const files = command.argv.filter(word => /\.\w+$/u.test(word) && !word.startsWith('-'))
  if (files.length <= keep) return display(command)
  const shown = new Set(files.slice(0, keep))
  const argv = command.argv.filter(word => !files.includes(word) || shown.has(word))
  return `${display({...command, argv})} … (+${files.length - keep} files)`
}

export async function runGate(
  gate: Gate,
  context: GateContext,
  options: {limit?: number; progress?: (line: string) => void} = {},
): Promise<GateResult> {
  const plan = gate.plan(context)
  if ('skip' in plan) return {gate: gate.name, status: 'skip', reason: plan.skip}
  const started = Date.now()
  if ('internal' in plan) {
    const problems = plan.internal()
    return {
      gate: gate.name,
      status: problems.length ? 'fail' : 'pass',
      durationMs: Date.now() - started,
      ...(problems.length ? bound(problems, options.limit ?? 5) : {}),
    }
  }
  const commands: string[] = []
  for (const command of plan.commands) {
    options.progress?.(`  $ ${command.argv.join(' ')}`)
    const ran = await run(context.root, command)
    commands.push(abbreviate(command))
    if (ran.exitCode !== 0) {
      const problems = ran.missing
        ? [{file: undefined, line: undefined, message: `${ran.missing} is not installed or not on PATH`}]
        : (gate.parse ?? parseProblems)(ran.output, context.root)
      return {
        gate: gate.name,
        status: 'fail',
        durationMs: Date.now() - started,
        commands,
        ...bound(problems, options.limit ?? 5),
        ...(problems.length ? {} : {tail: tail(ran.output)}),
        ...(gate.fix ? {fix: gate.fix} : {}),
        ...(plan.note ? {reason: plan.note} : {}),
      }
    }
  }
  return {gate: gate.name, status: 'pass', durationMs: Date.now() - started, commands, ...(plan.note ? {reason: plan.note} : {})}
}
