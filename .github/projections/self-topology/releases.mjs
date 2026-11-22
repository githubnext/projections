// Self topology: where each unit ships, read from what the release workflows attach and publish, never from publish
// configuration a manifest merely allows (`publisher`, a package that isn't private, a crate without `publish = false`).
//
// - A release asset: a crate the dist configuration releases (`packages` in `dist-workspace.toml`, or every binary crate
//   without one), and a unit whose release script (`node <unit>/…release….mjs`) a dist artifacts job runs before it
//   uploads its artifacts (`global-artifacts-jobs`, `local-artifacts-jobs`).
// - A GitHub Action: a unit whose scripts the root's `action.yml` runs (`runs.main`, `pre` and `post`, or a composite
//   step's `node "$GITHUB_ACTION_PATH/…"`), which ships with
//   the repository's tags (`uses: owner/repo@v0`).
// - A registry: a workflow step that runs `npm publish`, `vsce publish`, `ovsx publish` or `cargo publish` for a unit,
//   or a dist `publish-jobs` entry (`npm`, `homebrew`) for the crates it releases. A publishing job whose condition
//   reads repository configuration (`vars.` or `secrets.`, itself or through a job it `needs`) is inert at this
//   revision, which can't see that configuration, so it publishes nothing here: an npm job that waits for approval is
//   no npm release. Turning publishing on in the workflow (an unconditional step, a dist `publish-jobs` entry) shows it.

const registries = [
  {pattern: /\bnpm\s+publish\b(.*)$/, registry: 'npm', option: /(?:--workspace|-w)[ =](\S+)/},
  {pattern: /\b(?:@vscode\/)?vsce\s+publish\b(.*)$/, registry: 'Marketplace', option: /(?:--packagePath|-i)[ =](\S+)/, vscode: true},
  {pattern: /\bovsx\s+publish\b(.*)$/, registry: 'Open VSX', option: /(?:--packagePath|-i)[ =](\S+)/, vscode: true},
  {pattern: /\bcargo\s+publish\b(.*)$/, registry: 'crates.io', option: /(?:--package|-p)[ =](\S+)/, crate: true},
]
const distRegistries = {npm: 'npm', homebrew: 'Homebrew'}

/** The scripts an `action.yml` runs, relative to the action's directory, with their lines. */
export function actionScripts(text) {
  return text.split('\n').flatMap((line, index) => {
    const script =
      /^\s+(?:main|pre|post):\s*['"]?([^\s'"]+)/.exec(line)?.[1] ??
      /\bnode\s+['"]?(?:\$GITHUB_ACTION_PATH|\$\{\{\s*github\.action_path\s*\}\})\/([^\s'"]+)/.exec(line)?.[1]
    return script ? [{script, line: index + 1}] : []
  })
}

/** A TOML array's strings: `key = ["a", "b"]` (on one or more lines) in `text`, or undefined when absent. */
export function tomlList(text, key) {
  const literal = key.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')
  const match = new RegExp(`^\\s*${literal}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(text)
  return match ? [...match[1].matchAll(/["']([^"']+)["']/g)].map(([, value]) => value) : undefined
}

/** The `[dist]` table of `dist-workspace.toml`, else Cargo.toml's `[workspace.metadata.dist]`; '' without either. */
function distTable(text) {
  const start = /^\[(?:dist|workspace\.metadata\.dist)\]\s*$/m.exec(text)
  if (!start) return ''
  const rest = text.slice(start.index + start[0].length)
  const next = /^\[[^\]]+\]\s*$/m.exec(rest)
  return {text: next ? rest.slice(0, next.index) : rest, offset: start.index + start[0].length}
}

/** A workflow's jobs: each one's name, its lines (text and 1-based number) and its own condition. */
export function workflowJobs(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^jobs:\s*$/.test(line))
  if (start < 0) return []
  const jobs = []
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    const name = /^ {2}([\w-]+):\s*$/.exec(line)?.[1]
    if (name) jobs.push({name, lines: []})
    else if (/^\S/.test(line)) break
    else if (jobs.length && !/^\s*#/.test(line)) jobs.at(-1).lines.push({text: line, line: index + 1})
  }
  for (const job of jobs) job.condition = job.lines.map(entry => /^ {4}if:\s*(.*)$/.exec(entry.text)?.[1]).find(Boolean) ?? ''
  return jobs
}

const configuration = /\b(vars|secrets)\./
/** Whether a job runs only as repository configuration says: its condition reads it, or a job it needs computes it. */
function gated(job, jobs) {
  if (configuration.test(job.condition)) return true
  return [...job.condition.matchAll(/\bneeds\.([\w-]+)\.outputs\b/g)].some(([, name]) =>
    jobs.find(other => other.name === name)?.lines.some(({text}) => configuration.test(text)),
  )
}

/**
 * Where each unit ships: unit ID → `[{channel, source, line}]`, a channel being `release asset` or a registry's name.
 * `owner(root, path)` is the unit owning a repository path; `units` are the extractor's.
 */
export function releaseChannels({roots, read, files, units, owner}) {
  const channels = new Map()
  const add = (unit, channel, source, line) => {
    if (!unit) return
    const list = channels.get(unit.id) ?? []
    if (!list.some(entry => entry.channel === channel)) list.push({channel, source, line})
    channels.set(unit.id, list)
  }
  const crates = [...units.values()].filter(unit => unit.kind === 'rust-crate')
  for (const root of roots) {
    const prefix = root.path ? `${root.path}/` : ''
    const own = crates.filter(unit => unit.root === root.path)
    const distFile = files.includes(`${prefix}dist-workspace.toml`) ? `${prefix}dist-workspace.toml` : `${prefix}Cargo.toml`
    const distText = read(distFile)
    const dist = distTable(distText)
    // The crates dist releases: its `packages`, else every binary crate.
    const released = dist
      ? (tomlList(dist.text, 'packages')
          ?.map(name => own.find(unit => unit.data.package === name))
          .filter(Boolean) ?? own.filter(unit => unit.data.targets.includes('bin')))
      : []
    const lineOf = needle => {
      const at = distText.indexOf(needle, dist?.offset ?? 0)
      return at < 0 ? undefined : distText.slice(0, at).split('\n').length
    }
    for (const unit of released) add(unit, 'release asset', distFile, lineOf(`"${unit.data.package}"`) ?? lineOf('packages'))
    for (const {script, line} of actionScripts(read(`${prefix}action.yml`))) {
      add(owner(root.path, `${prefix}${script}`), 'GitHub Action', `${prefix}action.yml`, line)
    }
    for (const job of dist ? (tomlList(dist.text, 'publish-jobs') ?? []) : []) {
      if (distRegistries[job]) for (const unit of released) add(unit, distRegistries[job], distFile, lineOf('publish-jobs'))
    }
    // The workflows dist runs to build release artifacts: what they upload is attached to the release.
    const artifactJobs = new Set(
      dist
        ? ['global-artifacts-jobs', 'local-artifacts-jobs'].flatMap(key =>
            (tomlList(dist.text, key) ?? []).map(job => `${prefix}.github/workflows/${job.replace(/^\.\//, '')}.yml`),
          )
        : [],
    )
    const workflows = files.filter(file => file.startsWith(`${prefix}.github/workflows/`) && /\.ya?ml$/.test(file))
    for (const workflow of workflows) {
      const jobs = workflowJobs(read(workflow))
      for (const job of jobs) {
        if (artifactJobs.has(workflow) && job.lines.some(({text}) => /\buses:\s*actions\/upload-artifact@/.test(text))) {
          for (const {text, line} of job.lines) {
            for (const [, script] of text.matchAll(/\bnode\s+(\S*release[^\s/]*\.[cm]?js)\b/g)) {
              let unit = owner(root.path, `${prefix}${script}`)
              // A release script beside a crate dist releases packages that crate's binaries.
              unit = released.find(crate => crate.directory === unit?.directory) ?? unit
              add(unit, 'release asset', workflow, line)
            }
          }
        }
        if (gated(job, jobs)) continue
        const directory = job.lines.map(({text}) => /^\s+working-directory:\s*(\S+)/.exec(text)?.[1]).find(Boolean)
        for (const {text, line} of job.lines) {
          for (const {pattern, registry, option, vscode, crate} of registries) {
            const command = pattern.exec(text)
            if (!command) continue
            const named = option.exec(command[1])?.[1]
            const targets = crate
              ? own.filter(unit => unit.data.package === named)
              : named || directory
                ? [owner(root.path, `${prefix}${named ?? directory}`)]
                : vscode
                  ? [...units.values()].filter(unit => unit.root === root.path && unit.meta?.vscode)
                  : [owner(root.path, root.path)]
            for (const unit of targets) add(unit, registry, workflow, line)
          }
        }
      }
    }
  }
  return channels
}

/** How a channel reads on a card: `release asset`, `GitHub Action`, or `on npm`. */
export const channelWords = channel => (channel === 'release asset' || channel === 'GitHub Action' ? channel : `on ${channel}`)
