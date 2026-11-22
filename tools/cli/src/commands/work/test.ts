// `test`: workspace suites, Rust crates and, only when asked, one browser project.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {bound, TOOLS} from '../../lib/gates.ts'
import {findUnit, inDependencyOrder, loadUnits, type Unit} from '../../lib/packages.ts'
import {parseProblems, tail, type Problem} from '../../lib/problems.ts'
import {run, type Command} from '../../lib/repo.ts'
import {availableMemory, gigabytes} from '../../lib/machine.ts'
import {changeSet, UsageError} from './change-set.ts'

export interface TestOptions {
  target?: string | undefined
  affected?: boolean | undefined
  since?: string | undefined
  rust?: boolean | undefined
  browser?: string | undefined
  /** Only tests whose name matches: node's --test-name-pattern, cargo test's filter, Playwright's --grep. */
  filter?: string | undefined
  limit?: number | undefined
}

export interface Run {
  target: string
  command: Command
}

export interface TestRun {
  target: string
  command: string
  status: 'pass' | 'fail'
  durationMs: number
  passed?: number
  failed?: number
  problems?: Problem[]
  moreProblems?: number
  tail?: string[]
}

/** Counts from node:test (TAP and spec reporters), cargo test and Playwright summaries. */
export function counts(output: string): {passed?: number; failed?: number} {
  let passed = 0
  let failed = 0
  let seen = false
  for (const match of output.matchAll(/^(?:# |ℹ )(pass|fail) (\d+)$/gm)) {
    seen = true
    if (match[1] === 'pass') passed += Number(match[2])
    else failed += Number(match[2])
  }
  for (const match of output.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
    seen = true
    passed += Number(match[1])
    failed += Number(match[2])
  }
  for (const match of output.matchAll(/^\s+(\d+) (passed|failed|flaky)\b/gm)) {
    seen = true
    if (match[2] === 'passed') passed += Number(match[1])
    else if (match[2] === 'failed') failed += Number(match[1])
  }
  return seen ? {passed, failed} : {}
}

const MAX_BROWSER_WORKERS = 2

/**
 * NODE_OPTIONS selecting the tests whose name matches. Workspaces' test scripts name their files
 * (`node --test test/*.test.mjs`), and node reads options only before those, so an appended one is ignored.
 */
export function nodeTestPattern(filter: string): string {
  return [process.env.NODE_OPTIONS, `--test-name-pattern="${filter.replace(/[\\"]/g, '\\$&')}"`].filter(Boolean).join(' ')
}

/** The test commands for the options: workspace suites, Rust crates and, only when asked, one browser project. */
export function testPlan(root: string, options: TestOptions): {runs: Run[]; notes: string[]} {
  const units = loadUnits(root)
  const notes: string[] = []
  const runs: Run[] = []
  const filter = options.filter
  if (filter !== undefined && !options.target && !options.affected && options.since === undefined) {
    throw new UsageError('--filter needs a target or --affected', `${TOOLS} test packages/renderers/graph --filter layout`)
  }
  let targets: Unit[] | undefined
  if (options.target) {
    const unit = findUnit(units, options.target)
    if (!unit) throw new UsageError(`No workspace or crate ${options.target}`, `${TOOLS} map lists them`)
    targets = [unit]
  } else if (options.affected || options.since !== undefined) {
    const set = changeSet(root, options.since)
    const paths = inDependencyOrder(units, [...set.affected.changed, ...set.affected.dependants])
    targets = paths.map(path => units.find(unit => unit.path === path)!)
    if (!targets.length) notes.push('No workspace or crate changed.')
  }
  if (options.browser) {
    const project = options.browser
    const candidates = (targets ?? units).filter(unit => unit.scripts.includes('test:browser'))
    if (!candidates.length) notes.push('No selected workspace has browser tests.')
    for (const unit of candidates) {
      const script = JSON.parse(readFileSync(join(root, unit.path, 'package.json'), 'utf8')).scripts['test:browser'] as string
      const playwright = /playwright test\s*$/.test(script)
      runs.push({
        target: `${unit.path} (browser)`,
        command: {
          argv: [
            'npm',
            'run',
            'test:browser',
            '--workspace',
            unit.names[0]!,
            ...(playwright
              ? ['--', '--project', project, '--workers', String(MAX_BROWSER_WORKERS), ...(filter === undefined ? [] : ['--grep', filter])]
              : []),
          ],
        },
      })
      if (!playwright) notes.push(`${unit.path}'s browser suite isn't Playwright; it runs as its script defines.`)
    }
    const memory = availableMemory()
    if (memory.available < 4 * 1024 ** 3) {
      notes.push(
        `Only ${gigabytes(memory.available)} memory available; browser suites run one at a time with ${MAX_BROWSER_WORKERS} workers.`,
      )
    }
    return {runs, notes}
  }
  if (!targets) {
    runs.push({target: 'all workspaces', command: {argv: ['npm', 'test']}})
    if (options.rust) runs.push({target: 'all crates', command: {argv: ['cargo', 'test', '--locked', '--workspace']}})
    return {runs, notes}
  }
  const crates: string[] = []
  for (const unit of targets) {
    if (unit.kinds.includes('npm') && unit.scripts.includes('test')) {
      runs.push({
        target: unit.path,
        command: {
          argv: ['npm', 'test', '--workspace', unit.names[0]!],
          ...(filter === undefined ? {} : {env: {NODE_OPTIONS: nodeTestPattern(filter)}}),
        },
      })
    }
    // A crate-only target, or any crate when Rust is asked for or affected.
    const rust = options.rust || !unit.kinds.includes('npm') || options.affected || options.since !== undefined
    if (unit.kinds.includes('crate') && rust) crates.push(unit.names.at(-1)!)
  }
  if (crates.length) {
    runs.push({
      target: crates.length === 1 ? crates[0]! : `${crates.length} crates`,
      command: {argv: ['cargo', 'test', '--locked', ...crates.flatMap(crate => ['-p', crate]), ...(filter === undefined ? [] : [filter])]},
    })
  }
  if (!runs.length && targets.length) notes.push('The selected targets have no test script; pass --rust for their crates.')
  return {runs, notes}
}

export async function testReport(root: string, options: TestOptions, progress?: (line: string) => void) {
  const {runs, notes} = testPlan(root, options)
  const units = loadUnits(root)
  const results: TestRun[] = []
  for (const {target, command} of runs) {
    progress?.(`▸ ${target}: ${command.argv.join(' ')}`)
    const ran = await run(root, command)
    const status = ran.exitCode === 0 ? 'pass' : 'fail'
    const cwd = units.find(unit => unit.path === target)?.path ?? ''
    const problems =
      status === 'fail' ? parseProblems(ran.output, root, cwd).filter(problem => !/subtests? failed/.test(problem.message)) : []
    progress?.(`  ${status} (${Math.round(ran.durationMs / 1000)}s)`)
    results.push({
      target,
      command: ran.command,
      status,
      durationMs: ran.durationMs,
      ...counts(ran.output),
      ...(status === 'fail' ? bound(problems, options.limit ?? 8) : {}),
      ...(status === 'fail' && !problems.length ? {tail: ran.missing ? [`${ran.missing} is not installed`] : tail(ran.output, 15)} : {}),
    })
  }
  const failed = results.filter(result => result.status === 'fail')
  return {
    status: failed.length ? ('fail' as const) : ('pass' as const),
    runs: results,
    notes,
    next: failed.length
      ? [
          ...failed.flatMap(result => result.problems?.slice(0, 1).map(problem => `${TOOLS} explain ${problem.file}`) ?? []),
          `${TOOLS} test ${options.target ?? '--affected'}`,
        ].slice(0, 4)
      : [options.browser ? `${TOOLS} check --affected` : `${TOOLS} check --affected`],
  }
}
