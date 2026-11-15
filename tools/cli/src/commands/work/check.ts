// `check`: the repository's gates, for everything or for what a change touches.
import {TOOLS, gates, runGate, type GateContext, type GateResult} from '../../lib/gates.ts'
import {changeSet, split, UsageError} from './change-set.ts'

export type CheckOptions = {
  affected?: boolean | undefined
  since?: string | undefined
  only?: string[] | undefined
  clippy?: boolean | undefined
  limit?: number | undefined
}

export async function checkReport(root: string, options: CheckOptions, progress?: (line: string) => void) {
  const only = split(options.only)
  const unknown = only.filter(name => !gates.some(gate => gate.name === name))
  if (unknown.length) throw new UsageError(`Unknown gate ${unknown.join(', ')}`, `Gates: ${gates.map(gate => gate.name).join(', ')}`)
  const scoped = options.affected || options.since !== undefined
  const set = changeSet(root, options.since)
  const context: GateContext = {
    root,
    units: set.units,
    affected: scoped ? set.affected : undefined,
    files: scoped ? set.changes.filter(change => change.status !== 'deleted').map(change => change.path) : undefined,
  }
  const selected = gates.filter(gate =>
    only.length ? only.includes(gate.name) : !gate.optional || (gate.name === 'clippy' && options.clippy),
  )
  const results: GateResult[] = []
  for (const gate of selected) {
    const blocked = (gate.after ?? []).find(name => results.some(result => result.gate === name && result.status === 'fail'))
    if (blocked) {
      results.push({gate: gate.name, status: 'skip', reason: `${blocked} failed`})
      continue
    }
    progress?.(`▸ ${gate.name}`)
    const result = await runGate(gate, context, {limit: options.limit ?? 5, ...(progress ? {progress} : {})})
    progress?.(
      `  ${result.status}${result.durationMs !== undefined ? ` (${Math.round(result.durationMs / 1000)}s)` : ''}${result.reason ? `: ${result.reason}` : ''}`,
    )
    results.push(result)
  }
  const failed = results.filter(result => result.status === 'fail')
  const next = failed.length
    ? [
        ...failed.flatMap(result => {
          const first = result.problems?.find(problem => problem.file)
          return [
            ...(result.fix ? [result.fix] : []),
            ...(first?.file ? [`${TOOLS} explain ${first.file}`] : []),
            `${TOOLS} check --only ${result.gate}${scoped ? ' --affected' : ''}`,
          ]
        }),
      ]
    : scoped
      ? [`${TOOLS} test --affected${set.affected.kinds.includes('rust') ? ' --rust' : ''}`]
      : [`${TOOLS} test`]
  return {
    status: failed.length ? ('fail' as const) : ('pass' as const),
    scope: scoped ? `affected since ${set.base?.ref ?? 'HEAD'} (${set.changes.length} files)` : 'everything',
    gates: results.map(result => ({
      gate: result.gate,
      status: result.status,
      seconds: result.durationMs === undefined ? 0 : Math.round(result.durationMs / 100) / 10,
      note: result.reason ?? (result.status === 'fail' ? `${(result.problems?.length ?? 0) + (result.moreProblems ?? 0)} problems` : ''),
    })),
    failures: failed.map(result => ({
      gate: result.gate,
      commands: result.commands ?? [],
      problems: result.problems ?? [],
      ...(result.moreProblems ? {moreProblems: result.moreProblems} : {}),
      ...(result.tail ? {tail: result.tail} : {}),
      ...(result.fix ? {fix: result.fix} : {}),
    })),
    next: [...new Set(next)].slice(0, 6),
  }
}
