// Change hues only through the kit: a renderer built on the renderer kit colors a change with the kit's change marks,
// never the hue itself. The kit's `data-change` (and `pk-region`) set `--pk-change-ink`, `--pk-change-strong`,
// `--pk-change-highlight`, `--pk-region-fill` and `--pk-region-edge` for the change an element is marked with, and its
// nesting rule drains them from anything that holds changes, so only the innermost changes are colored. A renderer that
// names a change hue (the kit's `--green`, `--red-soft`, … or the theme's `--projections-color-added`, …), or reads one
// (`token.color('added')`, `getPropertyValue('--red')`), bypasses that. A renderer without the kit (the minimal example) colors changes from the theme's tokens itself and isn't read.
// Intentional uses, where a hue is categorical rather than a change, are in .change-hues.yaml, each with its reason;
// an exception that no longer matches fails too.
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'

const hue = String.raw`(?:green|red|amber|violet)(?:-(?:soft|border|strong|highlight))?`
const pattern = new RegExp(
  String.raw`var\(\s*--${hue}\s*[,)]|--projections-color-(?:added|removed|modified|moved)(?:-[a-z]+)?\b|color-(?:added|removed|modified|moved)(?:-[a-z]+)?['"\x60]|\.color\(\s*['"\x60](?:added|removed|modified|moved)(?:-[a-z]+)?['"\x60]|['"\x60]--${hue}['"\x60]`,
  'u',
)
export const advice =
  "Mark the element with its change (the kit's changeMark: data-change, or pk-region) and use var(--pk-change-ink), var(--pk-change-strong), var(--pk-change-highlight), var(--pk-region-fill) or var(--pk-region-edge), which follow emphasis and nesting"

/** The renderer workspaces built on the kit: their package.json depends on it; the kit itself and its tooling aren't. */
export function kitRenderer(directory, manifest) {
  if (/(?:^|\/)packages\/renderers\/(?:kit|sdk|testing|harness)$/u.test(directory)) return false
  const dependencies = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies}
  return '@githubnext/projections-renderer-kit' in dependencies
}

/** Whether `path` (in a kit renderer, '/'-separated) is source the rule reads: styles and code, not tests or fixtures. */
export function read(path) {
  if (!/\.(?:css|[cm]?[jt]sx?)$/u.test(path)) return false
  if (/(?:^|\/)(?:test|tests|fixtures|browser|dist|scripts)\//u.test(path)) return false
  return !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/u.test(path)
}

/** The lines of `text` naming a change hue, each `{line, text}`; comments are read too, so prose can't hide one. */
export function findings(text) {
  return text.split(/\r?\n/u).flatMap((line, index) => (pattern.test(line) ? [{line: index + 1, text: line.trim()}] : []))
}

/** The uses in `files` that `allowed` (the .change-hues.yaml entries, by path) doesn't excuse, and its stale entries. */
export function check(files, allowed) {
  for (const entry of allowed) {
    if (!entry.path || !entry.reason?.trim()) {
      throw new Error(`.change-hues.yaml: every entry needs a path and a reason: ${JSON.stringify(entry)}`)
    }
  }
  const used = new Set()
  const violations = []
  for (const [path, text] of files) {
    const found = findings(text)
    if (!found.length) continue
    const entry = allowed.find(candidate => candidate.path === path)
    if (entry) used.add(entry)
    else violations.push(...found.map(finding => ({path, ...finding})))
  }
  return {violations, stale: allowed.filter(entry => !used.has(entry))}
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  const directories = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*package.json')
    .split('\0')
    .filter(path => /^(?:packages\/renderers|examples\/renderers)\/[^/]+\/package\.json$/u.test(path))
    .map(path => path.slice(0, -'/package.json'.length))
    // Tracked files deleted from the working tree are still listed.
    .filter(directory => existsSync(join(root, directory, 'package.json')))
    .filter(directory => kitRenderer(directory, JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))))
  const files = []
  for (const directory of directories) {
    for (const path of git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', directory).split('\0')) {
      const relative = path.slice(directory.length + 1)
      if (path && read(relative) && existsSync(join(root, path))) files.push([path, readFileSync(join(root, path), 'utf8')])
    }
  }
  const allowed = parse(readFileSync(join(root, '.change-hues.yaml'), 'utf8'))?.allow ?? []
  const {violations, stale} = check(files, allowed)
  const problems = [
    ...violations.map(({path, line, text}) => `${path}:${line}: ${text}`),
    ...stale.map(entry => `.change-hues.yaml: ${entry.path} no longer names a change hue; remove the entry`),
  ]
  if (problems.length) {
    throw new Error(
      `Renderers built on the kit color changes only through its change marks (${advice}); fix each, or, where a hue is categorical rather than a change, add the file with its reason to .change-hues.yaml:\n${problems.join('\n')}`,
    )
  }
  console.log(
    `Change hues: ${files.length} files in ${directories.length} kit renderers name none beyond the ${allowed.length} in .change-hues.yaml`,
  )
}
