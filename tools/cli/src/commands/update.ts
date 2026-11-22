// `update`: brings vendored third-party code up to date from upstream. Unlike `fix` it needs the network, so it only
// runs when asked. The work is done by the owning workspace's script, run with --json and reported here.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {TOOLS} from '../lib/gates.ts'
import type {Problem} from '../lib/problems.ts'
import {tail} from '../lib/problems.ts'
import {display, run, type Command} from '../lib/repo.ts'
import {PrerequisiteError} from './install.ts'
import {UsageError} from './work/change-set.ts'

export const SHADCN_SCRIPT = 'packages/host/core/scripts/shadcn/update.mjs'
const COMPONENTS = 'packages/host/core/src/ui/components'

export interface ShadcnOptions {
  components?: readonly string[] | undefined
  check?: boolean | undefined
  dryRun?: boolean | undefined
  version?: string | undefined
  unreleased?: boolean | undefined
}

interface ComponentResult {
  name: string
  status: string
  conflicts?: number
  line?: number
}

type ScriptResult =
  | {
      status: 'pass' | 'fail'
      mode: 'check' | 'dry-run' | 'update'
      style: string
      ours: string
      upstream: string
      registry: {repository: string; head: string; moved: {sha: string; message: string; path: string}[]}
      components: ComponentResult[]
      written: boolean
    }
  | {error: {kind: 'usage' | 'prerequisite'; message: string; hint?: string}}

export function shadcnCommand(options: ShadcnOptions): Command {
  return {
    argv: [
      'node',
      SHADCN_SCRIPT,
      '--json',
      ...(options.check ? ['--check'] : []),
      ...(options.dryRun ? ['--dry-run'] : []),
      ...(options.version ? ['--version', options.version] : []),
      ...(options.unreleased ? ['--unreleased'] : []),
      ...(options.components ?? []),
    ],
  }
}

/** The script's one JSON line, the last line of its output that parses. */
export function parseScriptResult(output: string): ScriptResult | undefined {
  for (const line of output.trimEnd().split('\n').toReversed()) {
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line) as ScriptResult
    } catch {
      continue
    }
  }
  return undefined
}

/** The same request again, with `flags` in place of --check and --dry-run. */
function again(options: ShadcnOptions, ...flags: string[]): string {
  return [
    `${TOOLS} update shadcn`,
    ...flags,
    ...(options.version ? ['--version', options.version] : []),
    ...(options.unreleased ? ['--unreleased'] : []),
    ...(options.components ?? []),
  ].join(' ')
}

export function shadcnSummary(result: Exclude<ScriptResult, {error: unknown}>, options: ShadcnOptions) {
  const file = (name: string) => `${COMPONENTS}/${name}.tsx`
  const problems: Problem[] = []
  for (const component of result.components) {
    if (component.status === 'changed') {
      problems.push({file: file(component.name), line: undefined, message: `changed upstream since ${result.ours}`})
    }
    if (component.status === 'conflict') {
      problems.push({
        file: file(component.name),
        line: result.written ? component.line : undefined,
        message: `${component.conflicts} conflict(s) merging ${result.upstream}: ${
          result.written ? 'resolve the diff3 markers (ours, base, upstream)' : 'an update would leave diff3 markers'
        }`,
      })
    }
  }
  const changed = result.components.some(component => component.status !== 'unchanged')
  const next =
    result.mode === 'check'
      ? changed
        ? [again(options, '--dry-run'), again(options)]
        : []
      : result.mode === 'dry-run'
        ? changed
          ? [again(options)]
          : []
        : [
            ...(problems.length ? [`Resolve the conflicts in ${problems.map(problem => problem.file).join(', ')}`] : []),
            'git diff --stat',
            `${TOOLS} test host`,
            `${TOOLS} check --affected`,
          ]
  return {
    status: result.status,
    mode: result.mode,
    ours: result.ours,
    upstream: result.upstream,
    registry: `${result.registry.repository} main@${result.registry.head.slice(0, 7)}`,
    ...(result.registry.moved.length
      ? {moved: result.registry.moved.map(change => ({sha: change.sha.slice(0, 7), message: change.message, path: change.path}))}
      : {}),
    components: result.components.map(({name, status, conflicts}) => ({name, status, ...(conflicts ? {conflicts} : {})})),
    written: result.written,
    problems,
    next,
  }
}

export async function shadcnReport(root: string, options: ShadcnOptions, progress?: (line: string) => void) {
  if (options.check && options.dryRun) throw new UsageError('Pass --check or --dry-run, not both')
  if (!existsSync(join(root, SHADCN_SCRIPT))) throw new PrerequisiteError(`${SHADCN_SCRIPT} is missing`, 'Run it in a Projections checkout')
  const command = shadcnCommand(options)
  progress?.(`  $ ${display(command)}`)
  const ran = await run(root, command)
  const result = parseScriptResult(ran.output)
  if (!result) throw new Error(`${SHADCN_SCRIPT} exited ${ran.exitCode} without a result:\n${tail(ran.output).join('\n')}`)
  if ('error' in result) {
    const {kind, message, hint} = result.error
    throw kind === 'usage' ? new UsageError(message, hint) : new PrerequisiteError(message, hint)
  }
  return shadcnSummary(result, options)
}
