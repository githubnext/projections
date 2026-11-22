// The build dependencies no manifest declares, for the CI plan (ci-facts.ts): an npm workspace's `build` script, and
// the scripts it runs, compiling a crate (`cargo build -p <crate>`) or running another package's build script
// (packages/engine/js builds the default comparator; packages/comparators/runtime/js the rules interpreter).
import {existsSync} from 'node:fs'
import {join, posix} from 'node:path'
import {findUnit, ownerOf, type Unit} from './packages.ts'
import {readJson, readText} from './repo.ts'

const scriptPath = /\.(?:[cm]?js|ts)$/

/** Script files a script's text names: `node scripts/x.mjs`, `new URL('../x.mjs', import.meta.url)`, 'packages/…'. */
function scriptsNamed(root: string, text: string, from: string, directory: string): string[] {
  const named = [...text.matchAll(/(?:^|[\s'"\x60(])((?:\.{1,2}\/|packages\/|tools\/|scripts\/)[\w./-]+)/g)].map(match => match[1]!)
  return named
    .filter(path => scriptPath.test(path))
    .flatMap(path => [posix.normalize(posix.join(path.startsWith('.') ? from : directory, path)), posix.normalize(path)])
    .filter(path => !path.startsWith('..') && existsSync(join(root, path)))
}

/** The crates and workspaces a workspace's build compiles or builds, besides its manifest dependencies. */
export function buildDependencies(root: string, units: readonly Unit[], unit: Unit): string[] {
  const build = readJson<{scripts?: Record<string, string>}>(root, `${unit.path}/package.json`)?.scripts?.build ?? ''
  const found = new Set<string>()
  const seen = new Set<string>()
  const queue = scriptsNamed(root, build, unit.path, unit.path)
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const owner = ownerOf(units, file)
    if (owner && owner.path !== unit.path) found.add(owner.path)
    const text = readText(root, file) ?? ''
    for (const match of text.matchAll(/(?:-p|--package)['",\s]+([\w-]+)/g)) {
      const crate = findUnit(units, match[1]!)
      if (crate?.kinds.includes('crate') && crate.path !== unit.path) found.add(crate.path)
    }
    queue.push(...scriptsNamed(root, text, posix.dirname(file), '.'))
  }
  return [...found].toSorted()
}

/** The units with their build dependencies added to `dependsOn`. */
export function withBuildDependencies(root: string, units: readonly Unit[]): Unit[] {
  return units.map(unit =>
    unit.kinds.includes('npm')
      ? {...unit, dependsOn: [...new Set([...unit.dependsOn, ...buildDependencies(root, units, unit)])].toSorted()}
      : unit,
  )
}
