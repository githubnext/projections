// `fix`: the formatters and offline regenerators, then what they changed.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {TOOLS} from '../../lib/gates.ts'
import {generators} from '../../lib/generated.ts'
import {unmet} from '../../lib/needs.ts'
import {tail} from '../../lib/problems.ts'
import {git, run, type Command} from '../../lib/repo.ts'
import {changeSet, split, UsageError} from './change-set.ts'

/** Dirty files and their content hashes, to tell what a fix changed. */
function dirtyHashes(root: string): Map<string, string> {
  const status = git(root, ['status', '--porcelain=v1', '-uall', '--', '.']) ?? ''
  const hashes = new Map<string, string>()
  const prefix = git(root, ['rev-parse', '--show-prefix']) ?? ''
  for (const line of status.split('\n')) {
    const path = line
      .slice(3)
      .replace(/^.* -> /, '')
      .replaceAll(/^"|"$/g, '')
    if (!path) continue
    const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path
    const absolute = join(root, relative)
    hashes.set(relative, existsSync(absolute) ? createHash('sha1').update(readFileSync(absolute)).digest('hex') : 'deleted')
  }
  return hashes
}

export interface FixStep {
  name: string
  commands: Command[]
  reason?: string
}

export function fixPlan(
  root: string,
  options: {only?: string[] | undefined; affected?: boolean | undefined; since?: string | undefined},
): FixStep[] {
  const only = split(options.only)
  const scoped = options.affected || options.since !== undefined
  const set = scoped ? changeSet(root, options.since) : undefined
  const files = set?.changes.filter(change => change.status !== 'deleted').map(change => change.path) ?? []
  const steps: FixStep[] = []
  const formattable = files.filter(path => /\.([cm]?[jt]sx?|json|jsonc|ya?ml|css|html|toml)$/.test(path))
  steps.push(
    scoped && !formattable.length
      ? {name: 'format', commands: [], reason: 'no formattable file changed'}
      : {
          name: 'format',
          commands: [{argv: ['npx', '--no-install', 'oxfmt', ...(scoped ? ['--no-error-on-unmatched-pattern', ...formattable] : [])]}],
        },
  )
  steps.push(
    scoped && !set?.affected.kinds.includes('rust')
      ? {name: 'cargo-fmt', commands: [], reason: 'no Rust changed'}
      : {name: 'cargo-fmt', commands: [{argv: ['cargo', 'fmt', '--all']}]},
  )
  const regenerate = new Set(set?.affected.regenerate.map(generator => generator.name))
  for (const generator of generators) {
    const asked = only.includes(generator.name)
    if (!asked && (!generator.fix || (scoped && !regenerate.has(generator.name)))) continue
    const missing = unmet(root, generator.needs)
    steps.push(
      missing.length
        ? {name: generator.name, commands: [], reason: `needs ${missing.map(need => need.fix).join('; ')}`}
        : {name: generator.name, commands: generator.generate},
    )
  }
  const known = new Set(['format', 'cargo-fmt', ...generators.map(generator => generator.name)])
  const unknown = only.filter(name => !known.has(name))
  if (unknown.length) throw new UsageError(`Unknown fix ${unknown.join(', ')}`, `One of: ${[...known].join(', ')}`)
  return only.length ? steps.filter(step => only.includes(step.name)) : steps
}

export async function fixReport(
  root: string,
  options: {only?: string[] | undefined; affected?: boolean | undefined; since?: string | undefined},
  progress?: (line: string) => void,
) {
  const steps = fixPlan(root, options)
  const results: {step: string; status: 'ran' | 'failed' | 'skip'; changed?: string[]; reason?: string; tail?: string[]}[] = []
  for (const step of steps) {
    if (!step.commands.length) {
      results.push({step: step.name, status: 'skip', reason: step.reason ?? 'nothing to do'})
      continue
    }
    progress?.(`▸ ${step.name}`)
    const before = dirtyHashes(root)
    let failed: string[] | undefined
    for (const command of step.commands) {
      const ran = await run(root, command)
      if (ran.exitCode !== 0) {
        failed = ran.missing ? [`${ran.missing} is not installed`] : tail(ran.output, 6)
        break
      }
    }
    const after = dirtyHashes(root)
    const changed = [...after].filter(([path, hash]) => before.get(path) !== hash).map(([path]) => path)
    results.push({step: step.name, status: failed ? 'failed' : 'ran', changed: changed.slice(0, 30), ...(failed ? {tail: failed} : {})})
  }
  const changed = [...new Set(results.flatMap(result => result.changed ?? []))]
  const failed = results.filter(result => result.status === 'failed')
  return {
    status: failed.length ? ('fail' as const) : ('pass' as const),
    changed: changed.length,
    steps: results,
    next: changed.length ? ['git diff --stat', `${TOOLS} check --affected`] : [`${TOOLS} check --affected`],
  }
}
