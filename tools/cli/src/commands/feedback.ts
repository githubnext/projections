// `feedback`: drafts a GitHub issue about friction with this repository's tooling, and files it only with --submit.
import {spawnSync} from 'node:child_process'
import {homedir} from 'node:os'
import {TOOLS} from '../lib/gates.ts'
import {buildDraft, currentOs, FEEDBACK_LABEL, repositorySlug, similarity, type FeedbackInput} from '../lib/feedback.ts'
import {git, onPath, probe, readJson} from '../lib/repo.ts'
import {UsageError} from './work/change-set.ts'

type Manifest = {version?: string; repository?: string | {url?: string}}

/** The repository issues go to: tools' package.json `repository`, the root's, then the git remote. */
export function feedbackRepository(root: string): string {
  const slug =
    repositorySlug(readJson<Manifest>(root, 'tools/cli/package.json')?.repository) ??
    repositorySlug(readJson<Manifest>(root, 'package.json')?.repository) ??
    repositorySlug(git(root, ['remote', 'get-url', 'origin']))
  if (!slug) throw new UsageError('No GitHub repository found', 'Set `repository` in package.json or add an origin remote')
  return slug
}

function gh(root: string, args: string[]): {ok: boolean; stdout: string; stderr: string} {
  const result = spawnSync('gh', args, {cwd: root, encoding: 'utf8', timeout: 60_000})
  return {ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? ''}
}

export type FeedbackOptions = FeedbackInput & {submit?: boolean | undefined; comment?: number | undefined}

export function feedbackReport(root: string, options: FeedbackOptions) {
  if (!options.summary.trim())
    throw new UsageError('Describe the friction in one line', `${TOOLS} feedback "tools check --affected skipped the docs gate silently"`)
  const repository = feedbackRepository(root)
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const commit = git(root, ['rev-parse', '--short', 'HEAD'])
  const draft = buildDraft(
    options,
    {
      tools: readJson<Manifest>(root, 'tools/cli/package.json')?.version ?? 'unknown',
      os: currentOs(),
      node: process.version,
      rust: probe(root, ['rustc', '--version']),
      ref: commit ? `${branch ?? 'detached'} @ ${commit}` : undefined,
    },
    {repository, root, home: homedir()},
  )
  const preview = {title: draft.title, labels: draft.labels, body: draft.body}
  if (!options.submit) {
    return {
      status: 'draft' as const,
      repository,
      draft: preview,
      url: draft.url,
      next: [
        `${TOOLS} feedback ${JSON.stringify(options.summary)} --submit  — files it (asks gh, or prints the URL)`,
        'Open the URL to file it in a browser',
      ],
    }
  }
  const ready = onPath('gh') && gh(root, ['auth', 'status', '--hostname', 'github.com']).ok
  if (!ready) {
    return {
      status: 'url' as const,
      repository,
      draft: preview,
      url: draft.url,
      reason: 'gh is not installed or not authenticated',
      next: ['Open the URL to file the issue', 'gh auth login, then submit again'],
    }
  }
  if (options.comment !== undefined) {
    const commented = gh(root, ['issue', 'comment', String(options.comment), '--repo', repository, '--body', draft.body])
    if (!commented.ok) throw new UsageError(`gh issue comment failed: ${commented.stderr.trim().split('\n').pop()}`)
    return {status: 'commented' as const, repository, issue: options.comment, url: commented.stdout.trim(), next: [`${TOOLS} context`]}
  }
  const listed = gh(root, [
    'issue',
    'list',
    '--repo',
    repository,
    '--state',
    'open',
    '--label',
    FEEDBACK_LABEL,
    '--search',
    options.summary,
    '--json',
    'number,title,url',
    '--limit',
    '10',
  ])
  const open = listed.ok ? (JSON.parse(listed.stdout || '[]') as {number: number; title: string; url: string}[]) : []
  const similar = open
    .map(issue => ({...issue, similarity: Math.round(similarity(issue.title, draft.title) * 100) / 100}))
    .filter(issue => issue.similarity >= 0.4)
    .sort((a, b) => b.similarity - a.similarity)
  if (similar.length) {
    return {
      status: 'duplicate?' as const,
      repository,
      similar: similar.slice(0, 3),
      draft: preview,
      next: [
        `${TOOLS} feedback ${JSON.stringify(options.summary)} --submit --comment ${similar[0]?.number}  — add this as a comment instead`,
        'Reword the summary if it is a different problem',
      ],
    }
  }
  const create = (labels: boolean) =>
    gh(root, [
      'issue',
      'create',
      '--repo',
      repository,
      '--title',
      draft.title,
      '--body',
      draft.body,
      ...(labels ? ['--label', FEEDBACK_LABEL] : []),
    ])
  let created = create(true)
  let note: string | undefined
  if (!created.ok && /label/i.test(created.stderr)) {
    created = create(false)
    note = `The ${FEEDBACK_LABEL} label doesn't exist in ${repository}; filed without it.`
  }
  if (!created.ok)
    return {
      status: 'url' as const,
      repository,
      draft: preview,
      url: draft.url,
      reason: `gh issue create failed: ${created.stderr.trim().split('\n').pop()}`,
      next: ['Open the URL to file the issue'],
    }
  return {status: 'filed' as const, repository, url: created.stdout.trim(), ...(note ? {note} : {}), next: [`${TOOLS} context`]}
}
