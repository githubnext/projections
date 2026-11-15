// Commits this run's snapshots through the GitHub API, when the workflow opts in:
// on a push to the default branch with `snapshots-commit`, into `snapshots-path`
// so a README can embed them; on a pull request from this repository with
// `snapshots-branch`, under `pull/<number>/` on that dedicated branch, so the
// comment can show them. Commits are skipped when nothing changed. Nothing here
// runs repository code, and no Git credentials are written to disk.
import {appendFileSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {gitBlobSha, snapshotIndex, snapshotTarget} from './lib.mjs'

const environment = process.env
const output = (name, value) => {
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const warn = message => console.log(`::warning title=Projections snapshots::${message}`)
const directory = environment.PROJECTIONS_SNAPSHOTS
if (!directory) throw new Error('PROJECTIONS_SNAPSHOTS must be set')
const index = JSON.parse(readFileSync(path.join(directory, snapshotIndex), 'utf8'))
const test = environment.PROJECTIONS_TEST_EVENT_PATH
const event = JSON.parse(readFileSync(test || environment.GITHUB_EVENT_PATH, 'utf8'))
const repository = environment.GITHUB_REPOSITORY ?? ''
const target = snapshotTarget(
  index.subject,
  event,
  {
    commit: environment.INPUT_SNAPSHOTS_COMMIT === 'true',
    path: environment.INPUT_SNAPSHOTS_PATH || '.github/projections/snapshots',
    branch: environment.INPUT_SNAPSHOTS_BRANCH,
    message: environment.INPUT_SNAPSHOTS_COMMIT_MESSAGE,
  },
  repository,
)
if (!target.branch) {
  console.log(`Snapshots are not committed: ${target.reason}.`)
  process.exit(0)
}

const api = `${environment.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}`
const headers = {
  authorization: `Bearer ${environment.GH_TOKEN}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
}
async function request(route, init = {}) {
  const response = await fetch(`${api}${route}`, {...init, headers})
  if (!response.ok) {
    const error = new Error(`GitHub returned ${response.status} for ${init.method ?? 'GET'} ${route.split('?')[0]}`)
    error.status = response.status
    throw error
  }
  return response.json()
}
const encode = value => value.split('/').map(encodeURIComponent).join('/')

/** The branch's head commit, or undefined when it doesn't exist. */
async function head(branch) {
  try {
    return (await request(`/git/ref/heads/${encode(branch)}`)).object.sha
  } catch (error) {
    if (error.status === 404) return undefined
    throw error
  }
}

/** The blob ID of a committed file, or undefined. */
async function committed(file, commit) {
  try {
    const value = await request(`/contents/${encode(file)}?ref=${commit}`)
    return Array.isArray(value) ? undefined : value.sha
  } catch (error) {
    if (error.status === 404) return undefined
    throw error
  }
}

try {
  const files = index.snapshots.map(snapshot => ({
    name: snapshot.path,
    path: `${target.directory}/${snapshot.path}`,
    bytes: readFileSync(path.join(directory, snapshot.path)),
  }))
  let parent = await head(target.branch)
  if (target.expected && parent !== target.expected) {
    warn(`${target.branch} moved on from ${target.expected.slice(0, 7)}; a later run will commit newer snapshots.`)
    process.exit(0)
  }
  if (!parent && !target.orphan) throw new Error(`Branch ${target.branch} does not exist`)
  const changed = []
  for (const file of files) {
    if (!parent || (await committed(file.path, parent)) !== gitBlobSha(file.bytes)) changed.push(file)
  }
  if (changed.length) {
    const tree = parent ? (await request(`/git/commits/${parent}`)).tree.sha : undefined
    const entries = []
    for (const file of changed) {
      const blob = await request('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({content: file.bytes.toString('base64'), encoding: 'base64'}),
      })
      entries.push({path: file.path, mode: '100644', type: 'blob', sha: blob.sha})
    }
    const created = await request('/git/trees', {method: 'POST', body: JSON.stringify({...(tree ? {base_tree: tree} : {}), tree: entries})})
    const commit = await request('/git/commits', {
      method: 'POST',
      body: JSON.stringify({message: target.message, tree: created.sha, parents: parent ? [parent] : []}),
    })
    if (parent) {
      // Never forced: a concurrent push wins, and this run's snapshots are dropped.
      await request(`/git/refs/heads/${encode(target.branch)}`, {method: 'PATCH', body: JSON.stringify({sha: commit.sha, force: false})})
    } else {
      await request('/git/refs', {method: 'POST', body: JSON.stringify({ref: `refs/heads/${target.branch}`, sha: commit.sha})})
    }
    parent = commit.sha
    console.log(`Committed ${changed.length} snapshot(s) to ${target.branch} as ${commit.sha.slice(0, 7)}.`)
  } else console.log(`The snapshots on ${target.branch} are unchanged.`)
  // Pinned to the commit, so an updated comment never shows another run's images.
  const server = environment.GITHUB_SERVER_URL || 'https://github.com'
  const images = Object.fromEntries(files.map(file => [file.name, `${server}/${repository}/raw/${parent}/${encode(file.path)}`]))
  output('commit', parent)
  output('images', JSON.stringify(images))
} catch (error) {
  // A read-only token (pull requests from forks, or no contents: write) or a concurrent push.
  if ([403, 404, 409, 422].includes(error.status))
    warn(`Could not commit the snapshots (${error.message}). The workflow needs contents: write; they remain in the snapshots artifact.`)
  else throw error
}
