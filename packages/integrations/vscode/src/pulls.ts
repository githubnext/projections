/*
 * Pull requests for the Pull request… choice: listed with the GitHub CLI (`gh`), and compared locally from the pull
 * request's merge base with its base branch to its head commit (fetched from `origin` when it isn't here yet).
 */
import type {Pair} from './projections/pairs.js'
import {execFileOutput as run} from './exec.ts'

export interface PullRequest {
  number: number
  title: string
  headRefName: string
  baseRefName: string
  headRefOid: string
  isDraft: boolean
  author?: string
}

/** Reads `gh pr list --json number,title,headRefName,baseRefName,headRefOid,isDraft,author`. */
export function parsePullRequests(text: string): PullRequest[] {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const item = entry as Record<string, unknown> | null
    if (
      typeof item?.number !== 'number' ||
      typeof item.headRefOid !== 'string' ||
      !/^[0-9a-f]{40}$/.test(item.headRefOid) ||
      typeof item.baseRefName !== 'string'
    ) {
      return []
    }
    const author = (item.author as {login?: unknown} | undefined)?.login
    return [
      {
        number: item.number,
        title: typeof item.title === 'string' ? item.title : `#${item.number}`,
        headRefName: typeof item.headRefName === 'string' ? item.headRefName : '',
        baseRefName: item.baseRefName,
        headRefOid: item.headRefOid,
        isDraft: item.isDraft === true,
        ...(typeof author === 'string' ? {author} : {}),
      },
    ]
  })
}

/** Why pull requests can't be listed here (no remote, no GitHub CLI), or nothing when they can. */
export async function pullRequestsUnavailable(cwd: string): Promise<string | undefined> {
  try {
    const {stdout} = await run('git', ['remote'], {cwd})
    if (!stdout.trim()) return 'this repository has no remote'
  } catch {
    return 'this folder is not a Git repository'
  }
  try {
    await run('gh', ['--version'], {cwd, timeout: 5000})
  } catch {
    return 'needs the GitHub CLI (gh)'
  }
  return undefined
}

/** The repository's open pull requests, from `gh`. */
export async function listPullRequests(cwd: string): Promise<PullRequest[]> {
  try {
    const {stdout} = await run(
      'gh',
      ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,headRefName,baseRefName,headRefOid,isDraft,author'],
      {cwd, timeout: 30_000, env: {...process.env, GH_PROMPT_DISABLED: '1'}},
    )
    return parsePullRequests(stdout)
  } catch (error) {
    const stderr = (error as {stderr?: unknown}).stderr
    const line = typeof stderr === 'string' ? stderr.trim().split('\n')[0] : ''
    throw new Error(line || (error instanceof Error ? error.message : String(error)), {cause: error})
  }
}

/** The open pull request whose head is `branch`, from `gh`, or nothing (none, no remote, no GitHub CLI). */
export async function branchPullRequest(cwd: string, branch: string): Promise<number | undefined> {
  if (await pullRequestsUnavailable(cwd)) return undefined
  try {
    const {stdout} = await run('gh', ['pr', 'list', '--state', 'open', '--head', branch, '--limit', '1', '--json', 'number'], {
      cwd,
      timeout: 30_000,
      env: {...process.env, GH_PROMPT_DISABLED: '1'},
    })
    const [first] = JSON.parse(stdout) as {number?: unknown}[]
    return typeof first?.number === 'number' ? first.number : undefined
  } catch {
    return undefined
  }
}

async function hasCommit(cwd: string, commit: string): Promise<boolean> {
  return run('git', ['cat-file', '-e', `${commit}^{commit}`], {cwd}).then(
    () => true,
    () => false,
  )
}

/**
 * The pair a pull request compares, locally: the merge base of its base branch (`origin/<base>`, else `<base>`) with
 * its head commit → that commit. The head is fetched from `origin` (`refs/pull/<n>/head`, into no local ref) when it
 * isn't here.
 */
export async function pullRequestPair(cwd: string, pull: PullRequest): Promise<Pair> {
  const env = {...process.env, GIT_TERMINAL_PROMPT: '0'}
  if (!(await hasCommit(cwd, pull.headRefOid))) {
    await run('git', ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', `refs/pull/${pull.number}/head`], {
      cwd,
      env,
      timeout: 120_000,
    })
  }
  if (!(await hasCommit(cwd, pull.headRefOid))) throw new Error(`Couldn't fetch the head of pull request #${pull.number}`)
  for (const base of [`refs/remotes/origin/${pull.baseRefName}`, `refs/heads/${pull.baseRefName}`]) {
    try {
      const {stdout} = await run('git', ['merge-base', '--end-of-options', base, pull.headRefOid], {cwd})
      if (stdout.trim()) return {before: stdout.trim(), after: pull.headRefOid}
    } catch {
      // Try the next.
    }
  }
  throw new Error(`No ${pull.baseRefName} branch here to compare pull request #${pull.number} with`)
}
