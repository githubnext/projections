// Creates or updates the sticky pull request comment: the same summary as the job's, with before and after
// snapshots when the workflow rendered them, and a link to a hosted view only when hosted-url is set.
import {commentBody, commentMarker} from './lib.mjs'
import {loadReport} from './report.mjs'

const environment = process.env
const {manifest, documents, options} = loadReport(environment)
if (manifest.subject.kind !== 'pull-request') process.exit(0)
const api = environment.GITHUB_API_URL || 'https://api.github.com'
const base = `${api}/repos/${environment.GITHUB_REPOSITORY}/issues`
const headers = {
  authorization: `Bearer ${environment.GH_TOKEN}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
}
const warn = message => console.log(`::warning title=Projections comment::${message}`)

async function request(url, init = {}) {
  const response = await fetch(url, {...init, headers})
  if (!response.ok) {
    const error = new Error(`GitHub returned ${response.status} for ${init.method ?? 'GET'} ${new URL(url).pathname}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

try {
  let existing
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = await request(`${base}/${manifest.subject.number}/comments?per_page=100&page=${page}`)
    existing = comments.find(comment => comment.user?.type === 'Bot' && comment.body?.startsWith(commentMarker))
    if (comments.length < 100) break
  }
  const body = JSON.stringify({body: commentBody(manifest, documents, options)})
  if (existing) await request(`${base}/comments/${existing.id}`, {method: 'PATCH', body})
  else await request(`${base}/${manifest.subject.number}/comments`, {method: 'POST', body})
} catch (error) {
  // Pull requests from forks get a read-only token; the artifact is still published.
  if (error.status === 403 || error.status === 404)
    warn(`Could not comment (${error.message}). The workflow needs pull-requests: write; pull requests from forks never get it.`)
  else throw error
}
