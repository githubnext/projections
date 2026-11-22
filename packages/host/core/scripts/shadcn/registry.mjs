// Where upstream shadcn/ui items come from. The registry (ui.shadcn.com) serves only what is deployed from
// shadcn-ui/ui `main`; release tags don't contain the built radix-vega items (they are generated at deploy time with
// shadcn's style transform and Prettier's Tailwind class sorting). So a release is taken from the registry, and the
// GitHub API confirms that no input of that build has changed on `main` since the release's tag.
import {execFileSync} from 'node:child_process'

export const repository = 'shadcn-ui/ui'
export const itemUrl = (style, name) => `https://ui.shadcn.com/r/styles/${style}/${name}.json`

/** The paths in shadcn-ui/ui whose changes change a built radix-vega registry item. */
export const buildInputs = [
  'apps/v4/registry/bases/radix/ui',
  'apps/v4/registry/styles/style-vega.css',
  'packages/shadcn/src/styles',
  'apps/v4/scripts/build-registry.mts',
  'prettier.config.cjs',
]

/** The network or an upstream service failed: a missing prerequisite rather than a problem with the components. */
export class RegistryError extends Error {
  constructor(message, hint, status) {
    super(message)
    this.hint = hint
    this.status = status
  }
}

/** `fetch`, with network failures (offline, DNS, refused) as RegistryError. */
async function request(url, init) {
  try {
    return await fetch(url, init)
  } catch (error) {
    const reason = error?.cause?.code ?? error?.cause?.message ?? error?.message
    throw new RegistryError(`Can't reach ${new URL(url).host} (${reason})`, 'It needs the network: ui.shadcn.com and api.github.com')
  }
}

let token
function githubToken() {
  if (token !== undefined) return token
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  if (!token) {
    try {
      token = execFileSync('gh', ['auth', 'token'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
    } catch {
      token = ''
    }
  }
  return token
}

async function github(path) {
  const headers = {accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28'}
  if (githubToken()) headers.authorization = `Bearer ${githubToken()}`
  const response = await request(`https://api.github.com/repos/${repository}/${path}`, {headers})
  if (!response.ok) {
    throw new RegistryError(
      `GitHub ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`,
      [403, 429].includes(response.status) ? 'Rate limited: set GITHUB_TOKEN or run gh auth login' : undefined,
      response.status,
    )
  }
  return response.json()
}

/** `4.24.0` or `shadcn@4.24.0` → `4.24.0`. */
export const normalizeVersion = version => version.replace(/^shadcn@/u, '')
export const tagOf = version => `shadcn@${normalizeVersion(version)}`

/** The newest published `shadcn@x.y.z` release. */
export async function latestRelease() {
  const releases = await github('releases?per_page=50')
  const release = releases.find(candidate => /^shadcn@\d/u.test(candidate.tag_name) && !candidate.prerelease && !candidate.draft)
  if (!release) throw new Error(`no shadcn@ release in ${repository}`)
  return normalizeVersion(release.tag_name)
}

/** The commit a release tag points at. */
export async function tagCommit(version) {
  const commit = await github(`commits/${encodeURIComponent(tagOf(version))}`)
  return {sha: commit.sha, date: commit.commit.committer.date}
}

/** Commits on `main` after the tag that touched a build input, and `main`'s head. */
export async function changesSince(version) {
  const tag = await tagCommit(version)
  const head = await github('commits/main')
  const changes = new Map()
  for (const path of buildInputs) {
    const commits = await github(`commits?sha=main&since=${tag.date}&per_page=100&path=${encodeURIComponent(path)}`)
    for (const commit of commits) {
      if (commit.sha !== tag.sha) changes.set(commit.sha, {sha: commit.sha, message: commit.commit.message.split('\n')[0], path})
    }
  }
  return {tag, head: head.sha, changes: [...changes.values()]}
}

/** The registry item's JSON text, exactly as served. */
export async function fetchItem(style, name) {
  const response = await request(itemUrl(style, name))
  if (response.status === 404) return null
  if (!response.ok) throw new RegistryError(`${itemUrl(style, name)}: ${response.status}`)
  return response.text()
}
