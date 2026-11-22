// Checks the root package-lock.json and Cargo.lock against OSV (https://osv.dev), which aggregates GitHub's
// advisories for npm and RustSec's for crates.io. Fixture lockfiles are test data and aren't scanned.
//
//   node tools/scripts/osv-scan.mjs           fail on any advisory affecting a locked version
//   node tools/scripts/osv-scan.mjs --allow <id>  ignore one advisory (repeatable), e.g. a tracked maintenance notice
//
// It needs network access to api.osv.dev and sends only package names and versions. It never calls npm's audit endpoint.
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const api = 'https://api.osv.dev/v1'
const batchSize = 1000

/** Registry packages in an npm v2/v3 lockfile; workspace links and the root aren't published packages. */
export function npmPackages(lock) {
  const found = new Map()
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.includes('node_modules/') || entry.link || !entry.version) continue
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    found.set(`${name}@${entry.version}`, {ecosystem: 'npm', name, version: entry.version})
  }
  return [...found.values()]
}

/** crates.io packages in a Cargo.lock; path and git dependencies have no registry source. */
export function cratePackages(text) {
  const found = []
  for (const block of text.split(/^\[\[package\]\]$/mu).slice(1)) {
    const field = name => new RegExp(`^${name} = "([^"]*)"$`, 'm').exec(block)?.[1]
    if (field('source')?.startsWith('registry+')) found.push({ecosystem: 'crates.io', name: field('name'), version: field('version')})
  }
  return found
}

async function post(path, body) {
  const response = await fetch(`${api}${path}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
  if (!response.ok) throw new Error(`OSV ${path} answered ${response.status}: ${await response.text()}`)
  return response.json()
}

/** Advisory IDs per package; follows OSV's pagination for packages with many advisories. */
async function advisories(packages) {
  const results = []
  for (let start = 0; start < packages.length; start += batchSize) {
    const slice = packages.slice(start, start + batchSize)
    const queries = slice.map(({ecosystem, name, version}) => ({package: {ecosystem, name}, version}))
    const {results: batch} = await post('/querybatch', {queries})
    for (const [index, result] of batch.entries()) {
      const ids = (result.vulns ?? []).map(vuln => vuln.id)
      let token = result.next_page_token
      while (token) {
        const page = await post('/query', {...queries[index], page_token: token})
        ids.push(...(page.vulns ?? []).map(vuln => vuln.id))
        token = page.next_page_token
      }
      if (ids.length) results.push({...slice[index], ids})
    }
  }
  return results
}

async function summary(id) {
  const response = await fetch(`${api}/vulns/${encodeURIComponent(id)}`)
  if (!response.ok) return ''
  const vuln = await response.json()
  return vuln.summary ?? vuln.details?.split('\n')[0] ?? ''
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allowed = new Set(process.argv.flatMap((argument, index, argv) => (argv[index - 1] === '--allow' ? [argument] : [])))
  const packages = [
    ...npmPackages(JSON.parse(await readFile(`${root}package-lock.json`, 'utf8'))),
    ...cratePackages(await readFile(`${root}Cargo.lock`, 'utf8')),
  ]
  const affected = await advisories(packages)
  let failures = 0
  for (const {ecosystem, name, version, ids} of affected) {
    for (const id of ids) {
      const status = allowed.has(id) ? 'allowed' : 'advisory'
      if (status === 'advisory') failures++
      console.log(`${status} ${id} ${ecosystem} ${name}@${version}: ${await summary(id)}`)
    }
  }
  console.log(`osv: ${packages.length} packages checked, ${failures} unallowed advisories`)
  if (failures) process.exit(1)
}
