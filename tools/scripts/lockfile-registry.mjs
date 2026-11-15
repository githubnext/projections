// Keeps every package-lock.json on canonical npm registry URLs.
//
// Installs go through a registry mirror: the committed .npmrc selects packagefeedproxy.microsoft.io, and a
// machine may set another in ~/.npmrc. npm can then record the mirror's tarball URLs in `resolved`, which would
// tie the lockfiles to one mirror. npm maps registry.npmjs.org URLs to the configured registry when it fetches
// (`replace-registry-host`), so lockfiles keep npmjs URLs and still install through any mirror. The tarballs are
// identical, so `integrity` is unchanged.
//
//   node tools/scripts/lockfile-registry.mjs          fail if a lockfile resolves anywhere but registry.npmjs.org
//   node tools/scripts/lockfile-registry.mjs --fix    rewrite mirror URLs to their registry.npmjs.org equivalents
import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const npmjs = 'https://registry.npmjs.org/'
const fix = process.argv.includes('--fix')

/** The registry.npmjs.org URL for a tarball path ending in `<name>/-/<file>.tgz` (scoped names included). */
export function npmjsTarball(url) {
  const match = /\/((?:@[^/]+\/)?[^/]+)\/-\/([^/]+\.tgz)$/.exec(new URL(url).pathname)
  return match ? `${npmjs}${match[1]}/-/${match[2]}` : undefined
}

const lockfiles = execFileSync('git', ['ls-files', '--', 'package-lock.json', '**/package-lock.json'], {cwd: root, encoding: 'utf8'})
  .split('\n')
  .filter(Boolean)
const problems = []
for (const relative of lockfiles) {
  const path = `${root}${relative}`
  const lock = JSON.parse(await readFile(path, 'utf8'))
  let changed = false
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const resolved = entry?.resolved
    if (typeof resolved !== 'string' || !/^https?:/.test(resolved) || resolved.startsWith(npmjs)) continue
    const replacement = npmjsTarball(resolved)
    if (fix && replacement) {
      entry.resolved = replacement
      changed = true
    } else {
      problems.push(`${relative}: ${key || '(root)'} resolves to ${resolved}${replacement ? '' : ' (not a registry tarball URL)'}`)
    }
  }
  if (changed) await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`)
}
if (problems.length) {
  console.error(
    `Lockfiles must resolve packages from ${npmjs}. Run \`node tools/scripts/lockfile-registry.mjs --fix\`.\n${problems.join('\n')}`,
  )
  process.exit(1)
}
