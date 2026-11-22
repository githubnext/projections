// `context`, `map` and `explain`: what this repository is, what is in it, and what owns a file.
import {existsSync, readdirSync, statSync} from 'node:fs'
import {basename, dirname, extname, join} from 'node:path'
import {affected} from '../lib/affected.ts'
import {TOOLS} from '../lib/gates.ts'
import {generatorFor, markedFiles} from '../lib/generated.ts'
import {changedFiles, gitState, resolveBase} from '../lib/git.ts'
import {clip, describe, firstParagraph, listItems, section} from '../lib/markdown.ts'
import {findUnit, loadUnits, ownerOf, type Unit} from '../lib/packages.ts'
import {readText, relativeTo} from '../lib/repo.ts'
import {toolchains} from '../lib/toolchains.ts'

/** Where the repository's invariants live: a section of a contributor document, never this CLI. */
export const INVARIANTS = {file: 'CONTRIBUTING.md', heading: 'Invariants'}

export function invariants(root: string): string[] {
  const text = readText(root, INVARIANTS.file)
  const body = text && section(text, INVARIANTS.heading)
  return body ? listItems(body) : []
}

export interface Area {
  path: string
  packages: number
  description: string
}

/** Top-level directories holding workspaces or crates, each described by its own README or its packages. */
export function areas(root: string, units: readonly Unit[]): Area[] {
  const groups = new Map<string, Unit[]>()
  for (const unit of units) {
    const top = unit.path.split('/')[0]!
    groups.set(top, [...(groups.get(top) ?? []), unit])
  }
  return [...groups].map(([path, members]) => {
    const own = existsSync(join(root, path, 'README.md')) ? describe(readText(root, `${path}/README.md`)).description : undefined
    const fallback = members.length === 1 ? members[0]?.description : undefined
    const list = members.map(member => member.path.slice(path.length + 1) || member.path)
    return {path, packages: members.length, description: clip(own ?? fallback ?? list.join(', '), 140)}
  })
}

export function contextReport(root: string) {
  const units = loadUnits(root)
  const git = gitState(root)
  const base = resolveBase(root)
  const changes = changedFiles(root, base)
  const change = affected(units, changes)
  const tools = toolchains(root)
  const rules = invariants(root)
  const failing = tools.filter(tool => tool.status !== 'ok')
  const next = [
    `${TOOLS} map  — every workspace and crate`,
    ...(failing.length ? [`${TOOLS} doctor  — ${failing.map(tool => tool.name).join(', ')} not as required`] : []),
    ...(changes.length ? [`${TOOLS} affected  — what this change touches`, `${TOOLS} check --affected`, `${TOOLS} test --affected`] : []),
    `${TOOLS} docs search <words>`,
  ]
  return {
    purpose: clip(firstParagraph(readText(root, 'README.md') ?? '') ?? '(README.md has no first paragraph)', 400),
    areas: areas(root, units),
    toolchains: tools.map(tool => ({
      name: tool.name,
      required: tool.required ?? '',
      installed: tool.installed ?? 'missing',
      status: tool.status,
    })),
    git: {
      branch: git.branch ?? 'unknown',
      head: git.head ?? 'unknown',
      dirty: git.dirty,
      untracked: git.untracked,
      base: base ? `${base.ref} (${base.commit.slice(0, 8)}, ${base.reason})` : 'none found',
    },
    changed: {
      files: changes.length,
      packages: change.changed.slice(0, 20),
      dependants: change.dependants.length,
      other: change.unowned.length,
    },
    invariants: rules.length ? rules : [`(no "${INVARIANTS.heading}" section in ${INVARIANTS.file})`],
    invariantsSource: `${INVARIANTS.file}#${INVARIANTS.heading.toLowerCase()}`,
    next,
  }
}

export function mapReport(root: string, filter?: string) {
  const units = loadUnits(root).filter(
    unit => !filter || unit.path.startsWith(filter.replace(/\/$/u, '')) || unit.names.some(name => name.includes(filter)),
  )
  return {
    count: units.length,
    units: units.map(unit => ({
      path: unit.path,
      kind: unit.kinds.join('+'),
      name: unit.names.join(', '),
      description: unit.description ?? '(none)',
      ...(unit.source === 'front-matter' ? {} : {flag: unit.readme ? 'description from first paragraph; add front matter' : 'no README'}),
      dependsOn: unit.dependsOn,
    })),
  }
}

/** Test files beside a source file, and its package's test directories. */
function testsFor(root: string, path: string, unit: Unit | undefined): string[] {
  const found = new Set<string>()
  const directory = dirname(path)
  const stem = basename(path, extname(path)).replace(/\.(?:test|spec)$/u, '')
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) || /(?:^|\/)tests?\//u.test(path)) found.add(path)
  const look = (dir: string) => {
    if (!existsSync(join(root, dir))) return
    for (const entry of readdirSync(join(root, dir))) {
      if (entry.startsWith(`${stem}.`) && /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry)) found.add(`${dir}/${entry}`)
      if (entry === `${stem}.rs` && /(?:^|\/)tests$/u.test(dir)) found.add(`${dir}/${entry}`)
    }
  }
  look(directory)
  if (unit) for (const dir of ['test', 'tests', 'browser']) look(`${unit.path}/${dir}`)
  if (path.endsWith('.rs') && existsSync(join(root, path)) && (readText(root, path) ?? '').includes('#[cfg(test)]')) {
    found.add(`${path} (#[cfg(test)] module)`)
  }
  const suites = unit
    ? ['test', 'tests', 'browser']
        .map(dir => `${unit.path}/${dir}`)
        .filter(dir => existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory())
        .map(dir => `${dir}/`)
    : []
  return [...found, ...suites].slice(0, 12)
}

export function explainReport(root: string, target: string) {
  const path = relativeTo(root, target).replace(/^\.\//u, '').replace(/\/$/u, '')
  const units = loadUnits(root)
  const unit = findUnit(units, path) ?? ownerOf(units, path)
  const exists = existsSync(join(root, path))
  const generator = generatorFor(path)
  const marked = !generator && exists && statSync(join(root, path)).isFile() && markedFiles(root, [path]).length > 0
  const checks: string[] = []
  const tests: string[] = []
  const kind = (pattern: RegExp) => pattern.test(path)
  if (generator) checks.push(`${TOOLS} generated check --only ${generator.name}`)
  if (kind(/\.[cm]?[jt]sx?$/u)) checks.push(`${TOOLS} check --only format,lint,typecheck --affected`)
  if (kind(/\.(?:json|ya?ml|css|html)$/u)) checks.push(`${TOOLS} check --only format --affected`)
  if (kind(/\.rs$|Cargo\.toml$/u)) checks.push(`${TOOLS} check --only cargo-fmt,clippy --affected`)
  if (kind(/\.comparator(?:\.test)?\.ya?ml$/u) || kind(/\.md$/u)) checks.push(`${TOOLS} check --only comparators`)
  if (kind(/(?:^|\/)README\.md$/u)) checks.push(`${TOOLS} check --only readmes`)
  if (kind(/\.md$/u)) checks.push(`${TOOLS} check --only links`)
  if (!checks.length) checks.push(`${TOOLS} check --affected`)
  if (unit) {
    if (unit.kinds.includes('npm') && unit.scripts.includes('test')) tests.push(`${TOOLS} test ${unit.path}`)
    if (unit.kinds.includes('crate')) tests.push(`${TOOLS} test ${unit.path} --rust`)
    if (unit.scripts.includes('test:browser')) tests.push(`${TOOLS} test ${unit.path} --browser chromium-desktop`)
  }
  return {
    path,
    exists,
    owner: unit
      ? {path: unit.path, kind: unit.kinds.join('+'), name: unit.names.join(', '), description: unit.description ?? '(none)'}
      : {
          path: '.',
          kind: 'repository',
          name: 'workspace root',
          description: 'Not inside a workspace or crate: repository configuration, scripts or docs',
        },
    tests: testsFor(root, path, unit),
    generated: generator
      ? {
          by: generator.name,
          regenerate: generator.generate.map(command => command.argv.join(' ')).join(' && '),
          note: "Don't edit by hand.",
        }
      : marked
        ? {by: 'unregistered generator (header says generated)', regenerate: 'see the file header', note: "Don't edit by hand."}
        : (false as const),
    checks,
    run: tests,
  }
}
