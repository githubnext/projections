// `generated`: the registered generators and whether their committed outputs are current.
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {TOOLS} from '../../lib/gates.ts'
import {generators, markedFiles, outputFiles, walkAll, type Generator} from '../../lib/generated.ts'
import {unmet} from '../../lib/needs.ts'
import {parseProblems, tail} from '../../lib/problems.ts'
import {run, type Command} from '../../lib/repo.ts'
import {UsageError} from './change-set.ts'

const describeCommands = (commands: readonly Command[]) => commands.map(command => command.argv.join(' ')).join(' && ')

export function generatedList(root: string) {
  const files = walkAll(root)
  // Fixtures are test data: a header there describes the fixture's own project, not a file this repository generates.
  const marked = markedFiles(
    root,
    files.filter(path => !/(^|\/)fixtures\//.test(path)),
  )
  const unregistered = marked.filter(path => !generators.some(generator => outputFiles(root, generator, [path]).length))
  return {
    generators: generators.map(generator => ({
      name: generator.name,
      description: generator.description,
      outputs: generator.outputs,
      files: outputFiles(root, generator, files).length,
      generate: describeCommands(generator.generate),
      check:
        generator.check.mode === 'none'
          ? `none: ${generator.check.reason}`
          : generator.check.mode === 'snapshot'
            ? 'regenerate and compare'
            : describeCommands(generator.check.commands),
      needs: generator.needs,
    })),
    unregistered,
    rule: "Don't edit generated files by hand: change their sources, then regenerate (tools fix, or the generate command).",
    next: [`${TOOLS} generated check`, ...(unregistered.length ? ['Register these in tools/cli/src/lib/generated.ts'] : [])],
  }
}

type Snapshot = Map<string, string | undefined>

function snapshot(root: string, paths: readonly string[]): Snapshot {
  return new Map(paths.map(path => [path, existsSync(join(root, path)) ? readFileSync(join(root, path), 'latin1') : undefined]))
}

export interface GeneratorResult {
  name: string
  status: 'current' | 'stale' | 'skip' | 'error'
  detail?: string
  files?: string[]
  fix?: string
}

/** Checks one generator: its own `--check`, or regenerating and comparing (restoring the files afterwards). */
export async function checkGenerator(root: string, generator: Generator): Promise<GeneratorResult> {
  if (generator.check.mode === 'none') return {name: generator.name, status: 'skip', detail: generator.check.reason}
  if (generator.check.mode === 'tests') {
    return {name: generator.name, status: 'skip', detail: `checked by the tests: ${describeCommands(generator.check.commands)}`}
  }
  const missing = unmet(root, generator.needs)
  if (missing.length) {
    return {name: generator.name, status: 'skip', detail: `needs ${missing.map(need => `${need.need} (${need.fix})`).join('; ')}`}
  }
  const fix = `${TOOLS} fix --only ${generator.name}`
  if (generator.check.mode === 'script') {
    for (const command of generator.check.commands) {
      const ran = await run(root, command)
      if (ran.exitCode !== 0) {
        const files = parseProblems(ran.output, root)
          .map(problem => problem.file)
          .filter((file): file is string => !!file)
        const stale = ran.output.match(/^ {2}(\S+\.\w+)/gm)?.map(line => line.trim()) ?? []
        return {
          name: generator.name,
          status: 'stale',
          detail: tail(ran.output, 4).join(' | '),
          files: [...new Set([...stale, ...files])].slice(0, 10),
          fix,
        }
      }
    }
    return {name: generator.name, status: 'current'}
  }
  const before = snapshot(root, outputFiles(root, generator))
  try {
    for (const command of generator.generate) {
      const ran = await run(root, command)
      if (ran.exitCode !== 0) return {name: generator.name, status: 'error', detail: tail(ran.output, 4).join(' | ')}
    }
    // Committed outputs are formatted like every other file, so compare formatted output.
    const formattable = outputFiles(root, generator).filter(path => /\.([cm]?[jt]sx?|json|jsonc|ya?ml|css|html|toml)$/.test(path))
    if (formattable.length) await run(root, {argv: ['npx', '--no-install', 'oxfmt', '--no-error-on-unmatched-pattern', ...formattable]})
    const after = snapshot(root, outputFiles(root, generator))
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path))
    return changed.length ? {name: generator.name, status: 'stale', files: changed, fix} : {name: generator.name, status: 'current'}
  } finally {
    for (const path of outputFiles(root, generator)) if (!before.has(path)) rmSync(join(root, path), {force: true})
    for (const [path, text] of before) if (text !== undefined) writeFileSync(join(root, path), text, 'latin1')
  }
}

export async function generatedCheck(root: string, only: string[], progress?: (line: string) => void) {
  const unknown = only.filter(name => !generators.some(generator => generator.name === name))
  if (unknown.length) {
    throw new UsageError(`Unknown generator ${unknown.join(', ')}`, `Generators: ${generators.map(generator => generator.name).join(', ')}`)
  }
  const results: GeneratorResult[] = []
  for (const generator of generators.filter(candidate => !only.length || only.includes(candidate.name))) {
    progress?.(`▸ ${generator.name}`)
    results.push(await checkGenerator(root, generator))
  }
  const stale = results.filter(result => result.status === 'stale' || result.status === 'error')
  return {
    status: stale.length ? ('fail' as const) : ('pass' as const),
    results,
    next: stale.length ? stale.map(result => result.fix ?? `${TOOLS} generated`) : [`${TOOLS} check --affected`],
  }
}
