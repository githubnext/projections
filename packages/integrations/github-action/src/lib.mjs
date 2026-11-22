// Pure helpers for the Projections GitHub Action. No dependencies; Node 20 or later.
import {createHash} from 'node:crypto'

export const artifactManifest = 'projections.artifact.json'
export const commentMarker = '<!-- projections:sticky-comment -->'
export const maxProjections = 60
export const maxDocumentBytes = 8 * 1024 * 1024
const projectionId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const documentStatuses = new Set(['changed', 'unchanged', 'extracted', 'head-only', 'base-only'])

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export {expectedDigest, isMajorTag, newestInMajor, releaseAsset, releaseTag} from './release.mjs'

/**
 * What a workflow event asks the Action to do. Only `pull_request` and `push` are
 * supported: `pull_request_target` would run pull request code with the base repository's secrets.
 */
export function eventSubject(eventName, event, ref) {
  if (eventName === 'pull_request') {
    const pull = event?.pull_request
    const base = pull?.base?.sha
    const head = pull?.head?.sha
    if (!Number.isSafeInteger(pull?.number) || pull.number < 1 || !commit.test(base ?? '') || !commit.test(head ?? '')) {
      throw new Error('The pull_request event has no pull request number, base or head commit')
    }
    return {kind: 'pull-request', number: pull.number, base, head}
  }
  if (eventName === 'push') {
    const revision = event?.after
    if (!commit.test(revision ?? '') || /^0+$/.test(revision)) throw new Error('The push event has no commit (was a branch deleted?)')
    // eslint-disable-next-line no-control-regex -- Refs never contain control characters.
    if (!/^refs\/(?:heads|tags)\/[^\u0000-\u001f\u007f]{1,250}$/.test(ref ?? '')) throw new Error(`Unsupported push ref ${ref}`)
    return {kind: 'push', ref, revision}
  }
  throw new Error(
    `Projections runs on pull_request and push events, not ${eventName}. pull_request_target is refused because it would run pull request code with the base repository's secrets.`,
  )
}

/**
 * The CLI arguments for an event, as argv (never a shell string). CI's checkout is the revision, so a commit it
 * has checked out is extracted in place (`--in-place`); `artifacts` are downloaded artifact directories whose
 * verified extractions (the merge base's own CI run) are reused instead of extracting again.
 */
export function cliArguments(subject, {trust, output, artifacts = []}) {
  const common = [
    '--json',
    '--output',
    output,
    ...(trust ? ['--trust'] : []),
    '--in-place',
    ...artifacts.flatMap(directory => ['--artifact', directory]),
  ]
  return subject.kind === 'pull-request'
    ? ['compare', `${subject.mergeBase}..${subject.head}`, '--all', '--definition', 'base', ...common]
    : ['show', '--all', subject.revision, ...common]
}

const truncate = (value, length) => (value.length <= length ? value : `${value.slice(0, length - 1)}…`)
function diagnostics(values) {
  const list = (Array.isArray(values) ? values : []).slice(0, 20).map(value => ({
    severity: value?.severity === 'warning' ? 'warning' : 'error',
    code: truncate(String(value?.code || 'RUNNER_ERROR'), 100),
    path: truncate(String(value?.path ?? ''), 1024),
    message: truncate(String(value?.message || 'The projection failed'), 4096),
  }))
  return list.length ? list : [{severity: 'error', code: 'RUNNER_ERROR', path: '', message: 'The projection failed'}]
}
function notices(values) {
  const list = Array.isArray(values)
    ? values
        .filter(value => typeof value === 'string' && value)
        .slice(0, 20)
        .map(value => truncate(value, 4096))
    : []
  return list.length ? {notices: list} : {}
}

/**
 * Splits a CLI batch document into one file per projection plus the artifact
 * manifest. Returns the files to write, relative to the artifact root.
 */
export function splitBatch(batch, {subject, repository, run, cli, action, trust}) {
  const operation = subject.kind === 'pull-request' ? 'compare' : 'show'
  if (batch?.format !== 'projections.batch' || batch.version !== 0 || batch.operation !== operation || !Array.isArray(batch.results)) {
    throw new Error(`The CLI did not produce a ${operation} batch document`)
  }
  if (batch.results.length > maxProjections) {
    throw new Error(`At most ${maxProjections} projections fit in one artifact; this run produced ${batch.results.length}`)
  }
  const files = new Map()
  const projections = []
  for (const item of batch.results) {
    const id = item?.id
    if (typeof id !== 'string' || !projectionId.test(id) || projections.some(value => value.id === id)) {
      throw new Error(`Invalid or duplicate projection ID ${JSON.stringify(id)}`)
    }
    if (item.status === 'error') {
      const title = item.definition?.title
      projections.push({
        id,
        status: 'error',
        ...(typeof title === 'string' && title ? {title: truncate(title, 200)} : {}),
        diagnostics: diagnostics(item.diagnostics),
        ...notices(item.notices),
      })
      continue
    }
    if (!documentStatuses.has(item.status)) throw new Error(`Unknown status ${item.status} for projection ${id}`)
    const document = item.comparison ?? item.extraction
    const expected = ['changed', 'unchanged'].includes(item.status) ? 'projections.comparison' : 'projections.extraction'
    if (document?.format !== expected) throw new Error(`Projection ${id} has status ${item.status} but no ${expected} document`)
    const bytes = Buffer.from(`${JSON.stringify(document)}\n`)
    if (bytes.length > maxDocumentBytes) throw new Error(`Projection ${id}'s document exceeds ${maxDocumentBytes} bytes`)
    const path = `projections/${id}.json`
    files.set(path, bytes)
    projections.push({id, status: item.status, path, sha256: sha256(bytes), ...notices(item.notices)})
  }
  const manifest = {
    format: 'projections.artifact',
    version: 0,
    protocolVersion: 0,
    producer: {cli: truncate(cli, 100), ...(action ? {action: truncate(action, 200)} : {})},
    repository: {provider: 'github', id: repository.id, owner: repository.owner, name: repository.name},
    run: {id: run.id, attempt: run.attempt},
    subject:
      subject.kind === 'pull-request'
        ? {
            kind: 'pull-request',
            number: subject.number,
            base: subject.base,
            head: subject.head,
            mergeBase: subject.mergeBase,
            definition: 'base',
          }
        : {kind: 'push', ref: subject.ref, revision: subject.revision},
    trust: Boolean(trust),
    projections,
  }
  files.set(artifactManifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
  return {manifest, files}
}

/** GitHub's limits: a job summary's step output is at most 1 MiB, a comment at most 65,536 characters. */
export const summaryLimit = 900 * 1024
export const commentLimit = 60000

// Repository text (titles, labels, summaries, diagnostics) is untrusted: it is escaped so it can't add markup,
// links or images, and a word joiner after each @ keeps it from mentioning anyone.
const unmention = value => String(value ?? '').replaceAll('@', '@\u2060')
const oneLine = value => unmention(value).replaceAll(/\s+/g, ' ').trim()
/** Inline Markdown text. */
const plain = value =>
  oneLine(value)
    .replaceAll(/[\\\x60*_{}[\]<>()#+!|~]/g, '\\$&')
    .replaceAll('&', '&amp;')
/** HTML text, for <summary>. */
const html = value =>
  oneLine(value).replaceAll(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character])
/** A code span holding any text. */
function code(value) {
  const text = oneLine(value) || ' '
  const fence = '`'.repeat(Math.max(0, ...(text.match(/\x60+/g) ?? []).map(run => run.length)) + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}
const count = (number, one, many) => `${number} ${number === 1 ? one : many}`
const short = sha => code(String(sha ?? '').slice(0, 7))

/** The labels of an extraction's entities, by ID. */
function labels(extraction) {
  const map = new Map()
  for (const entity of extraction?.entities ?? []) map.set(entity.id, entity.label)
  return map
}
function entityName(names, id) {
  const label = names.get(id)
  return label && label !== id ? `${code(label)} (${code(id)})` : code(id)
}

/** One change of a comparison in words, as `projections compare` prints it. */
function describeChange(change, before, after) {
  const relationships = change.collection === 'relationships'
  const noun = relationships ? 'relationship' : 'entity'
  const name = (extraction, id) => {
    const names = labels(extraction)
    if (!relationships) return entityName(names, id)
    const relationship = (extraction?.relationships ?? []).find(value => value.id === id)
    return relationship
      ? `${entityName(names, relationship.from)} ${plain(relationship.label ?? relationship.kind)} ${entityName(names, relationship.to)}`
      : code(id)
  }
  const list = (extraction, ids) => (ids ?? []).map(id => name(extraction, id)).join(', ')
  const modified = change.status === 'modified' ? ' and changed' : ''
  const [old, now] = [list(before, change.before), list(after, change.after)]
  let line =
    change.status === 'added'
      ? `Added ${noun} ${now}`
      : change.status === 'removed'
        ? `Removed ${noun} ${old}`
        : change.correspondence === 'declared'
          ? `Renamed${modified} ${noun} ${old} to ${now}`
          : change.correspondence === 'split'
            ? `Split${modified} ${noun} ${old} into ${now}`
            : change.correspondence === 'merge'
              ? `Merged${modified} ${noun} ${old} into ${now}`
              : change.status === 'modified'
                ? `Changed ${noun} ${now}`
                : `Unchanged ${noun} ${now}`
  if (change.summary) line += `: ${plain(change.summary)}`
  return line
}

const changesShown = 25
/**
 * A comparison's counts, such as `3 changes in 2 steps: 2 added, 1 removed`. Whether it changed at all is the entry's
 * `status`, which the CLI took from the engine's review; this only words the listed changes, and an `unchanged` change
 * is listed either for its identity (renamed, split or merged) or for expected variation.
 */
function comparisonCounts(status, comparison) {
  const changes = comparison?.changes ?? []
  const counts = new Map()
  const tally = word => counts.set(word, (counts.get(word) ?? 0) + 1)
  for (const change of changes) {
    tally(change.status !== 'unchanged' ? change.status : change.correspondence === 'exact' ? 'varied' : 'renamed')
  }
  const words = {renamed: 'renamed without other changes', varied: 'varied within tolerance'}
  const parts = ['added', 'removed', 'modified', 'renamed', 'varied']
    .filter(word => counts.has(word))
    .map(word => `${counts.get(word)} ${words[word] ?? word}`)
  if (status === 'unchanged' || !changes.length) return parts.length ? `no changes to review (${parts.join(', ')})` : 'no changes'
  return `${count(changes.length, 'change', 'changes')} in ${count(comparison?.steps?.length ?? 0, 'step', 'steps')}: ${parts.join(', ')}`
}

/** A projection's one-line result and its details: a comparison's steps, an extraction's size or a failure's diagnostics. */
function projectionDetails(entry, document) {
  if (entry.status === 'error') {
    const lines = (entry.diagnostics ?? []).map(item => `- ${code(item.code)}: ${plain(item.message)}`)
    return {result: 'failed', lines}
  }
  const notices = (entry.notices ?? []).map(notice => `> ${plain(notice)}`)
  if (entry.status === 'changed' || entry.status === 'unchanged') {
    const {before, after, comparison} = document ?? {}
    const byId = new Map((comparison?.changes ?? []).map(change => [change.id, change]))
    const lines = [...notices, ...(notices.length ? [''] : [])]
    const steps = comparison?.steps ?? []
    for (const [index, step] of steps.entries()) {
      const title = [`**Step ${index + 1} of ${steps.length}**`, step.kind && `(${step.kind})`].filter(Boolean).join(' ')
      lines.push(`${index + 1}. ${title}${step.summary ? `: ${plain(step.summary)}` : ''}`)
      const ids = step.changes ?? []
      for (const id of ids.slice(0, changesShown)) {
        const change = byId.get(id)
        if (change) lines.push(`   - ${describeChange(change, before?.extraction, after?.extraction)}`)
      }
      if (ids.length > changesShown) lines.push(`   - …and ${ids.length - changesShown} more`)
    }
    return {result: comparisonCounts(entry.status, comparison), lines}
  }
  const extraction = document?.extraction
  const size = extraction
    ? `${count(extraction.entities?.length ?? 0, 'entity', 'entities')}, ${count(extraction.relationships?.length ?? 0, 'relationship', 'relationships')}`
    : 'extracted'
  return {result: size, lines: notices}
}

const statusText = {
  changed: 'Changed',
  unchanged: 'Unchanged',
  extracted: 'Extracted',
  'head-only': 'New in this pull request',
  'base-only': 'Only at the base',
  error: 'Failed',
}

/** The hosted view of this pull request or commit, only when an origin is configured. */
export function hostedLink(manifest, hostedUrl) {
  const origin = String(hostedUrl ?? '').trim()
  if (!origin) return undefined
  const url = new URL(origin)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`hosted-url must be an http(s) origin, not ${origin}`)
  const {owner, name} = manifest.repository
  const subject = manifest.subject.kind === 'pull-request' ? `pull/${manifest.subject.number}` : `commit/${manifest.subject.revision}`
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${subject}`
}

/**
 * The run's projections in Markdown, for the job summary and the pull request comment: what was compared, a
 * table of results, then each projection's steps and changes (or its failure), and how to review the artifact.
 * `documents` maps each projection ID to its document from the artifact. Details that don't fit `limit` bytes
 * are left out, with a note.
 */
export function summaryMarkdown(manifest, documents, {hostedUrl, artifactName = 'projections', snapshots, limit = summaryLimit} = {}) {
  const {subject} = manifest
  const counts = new Map()
  for (const projection of manifest.projections) counts.set(projection.status, (counts.get(projection.status) ?? 0) + 1)
  const tally =
    [...counts].map(([status, number]) => `${number} ${statusText[status].toLowerCase()}`).join(', ') || 'no projections defined'
  const details = manifest.projections.map(entry => ({entry, ...projectionDetails(entry, documents.get(entry.id))}))
  const link = hostedLink(manifest, hostedUrl)
  const head = [
    '### Projections',
    '',
    `${
      subject.kind === 'pull-request'
        ? `Compared ${short(subject.mergeBase)} (merge base) with ${short(subject.head)} for pull request #${subject.number}`
        : `Extracted ${short(subject.revision)} (${code(subject.ref)})`
    }: ${tally}.${link ? ` [View them on ${plain(new URL(link).host)}](${link}).` : ''}`,
    ...(details.length
      ? [
          '',
          '| Projection | Result |',
          '| --- | --- |',
          ...details.map(
            ({entry, result}) => `| ${code(entry.id)} | ${statusText[entry.status]}${entry.status === 'error' ? '' : `: ${result}`} |`,
          ),
        ]
      : []),
  ]
  const review =
    subject.kind === 'pull-request'
      ? `run ${code(`projections pr ${subject.number}`)} in a clone`
      : `run ${code(`projections show --all ${subject.revision.slice(0, 12)}`)} in a clone`
  const tail = [
    ...(snapshots ? snapshotSection(snapshots.index, snapshots) : []),
    '',
    `To explore a projection, open its document (${code('projections/<id>.json')} in this run's ${code(artifactName)} artifact) with **Projections: Open Artifact…** in VS Code, or ${review}.`,
    '',
    `<sub>Workflow run ${manifest.run.id}${manifest.trust ? ' · extractors that run repository code were trusted' : ''}.</sub>`,
  ]
  const size = lines => Buffer.byteLength(lines.join('\n')) + 1
  let budget = limit - size(head) - size(tail) - 200
  const body = []
  let omitted = 0
  for (const {entry, result, lines} of details) {
    if (!lines.length) continue
    const title = entry.title ?? documents.get(entry.id)?.before?.projection?.title ?? documents.get(entry.id)?.projection?.title
    const block = [
      '',
      `<details><summary><strong>${html(title ?? entry.id)}</strong> (<code>${html(entry.id)}</code>): ${html(statusText[entry.status].toLowerCase())}${entry.status === 'error' ? '' : `, ${html(result)}`}</summary>`,
      '',
      ...lines,
      '',
      '</details>',
    ]
    if (size(block) > budget) {
      omitted++
      continue
    }
    budget -= size(block)
    body.push(...block)
  }
  if (omitted) body.push('', `The details of ${count(omitted, 'projection', 'projections')} didn't fit here.`)
  return [...head, ...body, ...tail].join('\n')
}

/** The sticky pull request comment: the same summary, with any snapshots. */
export function commentBody(manifest, documents, options = {}) {
  return `${commentMarker}\n${summaryMarkdown(manifest, documents, {...options, limit: commentLimit - commentMarker.length - 1})}`
}

export const snapshotIndex = 'snapshots.json'
export const maxSnapshots = 20
export const snapshotThemes = ['light', 'dark']

/** The projection IDs the `snapshots` input lists, separated by commas, spaces or newlines. */
export function snapshotIds(text) {
  const ids = [
    ...new Set(
      String(text ?? '')
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  ]
  for (const id of ids) if (!projectionId.test(id)) throw new Error(`snapshots lists an invalid projection ID ${JSON.stringify(id)}`)
  if (ids.length > maxSnapshots) throw new Error(`snapshots lists ${ids.length} projections; at most ${maxSnapshots} are rendered`)
  return ids
}

/** A snapshot's file name: `<id>.<theme>.png` for a push, `<id>.<before|after>.<theme>.png` for a pull request. */
export function snapshotName(id, side, theme) {
  return `${id}.${side ? `${side}.` : ''}${theme}.png`
}

/**
 * What to render for each listed projection: both sides of a pull request's
 * comparison (or the one side a projection exists on), or a push's extraction.
 * Projections that weren't collected, or failed, are skipped with a reason.
 */
export function snapshotPlan(manifest, ids) {
  const renders = []
  const skipped = []
  for (const id of ids) {
    const entry = manifest.projections.find(projection => projection.id === id)
    if (!entry) skipped.push({id, reason: 'it is not defined at the examined revisions'})
    else if (entry.status === 'error') skipped.push({id, reason: 'the projection failed'})
    else if (entry.status === 'changed' || entry.status === 'unchanged') {
      for (const side of ['before', 'after']) renders.push({id, side, path: entry.path, part: side})
    } else if (entry.status === 'head-only') renders.push({id, side: 'after', path: entry.path})
    else if (entry.status === 'base-only') renders.push({id, side: 'before', path: entry.path})
    else renders.push({id, path: entry.path})
  }
  return {renders, skipped}
}

/** A directory in the repository for committed snapshots, such as `.github/projections/snapshots`. */
export function repositoryDirectory(text) {
  const value = String(text ?? '')
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
  const parts = value.split('/')
  if (
    !value ||
    value.length > 200 ||
    parts.some(part => !/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error(`snapshots-path must be a relative directory such as .github/projections/snapshots, not ${JSON.stringify(text)}`)
  }
  return value
}

const branchName = /^(?!-|\/|.*(?:\.\.|\/\/|\.lock$|\/$|@\{))[A-Za-z0-9._/-]{1,100}$/

/**
 * Where the snapshots of this run are committed, if anywhere: on a push to the
 * default branch with `snapshots-commit`, into `snapshots-path` on that branch;
 * on a pull request from this repository with `snapshots-branch`, under
 * `pull/<number>/` on that branch (created without history when missing).
 */
export function snapshotTarget(subject, event, {commit, path, branch, message}, repository) {
  if (subject.kind === 'push') {
    if (!commit) return {reason: 'snapshots-commit is not true'}
    const defaultBranch = event?.repository?.default_branch
    if (typeof defaultBranch !== 'string' || subject.ref !== `refs/heads/${defaultBranch}`) {
      return {reason: `snapshots are committed only for pushes to the default branch${defaultBranch ? ` (${defaultBranch})` : ''}`}
    }
    return {
      branch: defaultBranch,
      directory: repositoryDirectory(path),
      expected: subject.revision,
      message: message || 'Update Projections snapshots',
    }
  }
  if (!branch) return {reason: 'snapshots-branch is not set'}
  if (!branchName.test(branch)) throw new Error(`snapshots-branch ${JSON.stringify(branch)} is not a valid branch name`)
  const pull = event?.pull_request
  if (branch === pull?.base?.ref || branch === pull?.head?.ref || branch === event?.repository?.default_branch) {
    throw new Error('snapshots-branch must be a dedicated branch, not the pull request base, head or default branch')
  }
  if (pull?.head?.repo?.full_name !== repository) return {reason: 'pull requests from forks get a read-only token'}
  return {branch, directory: `pull/${subject.number}`, orphan: true, message: `Projections snapshots for #${subject.number}`}
}

/** Git's blob ID of some bytes, to tell whether a committed file already has them. */
export function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

const attribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A light snapshot that switches to its dark one with the viewer's theme. */
function picture(light, dark, alt) {
  return `<picture>${dark ? `<source media="(prefers-color-scheme: dark)" srcset="${attribute(dark)}">` : ''}<img src="${attribute(light)}" alt="${attribute(alt)}" width="420"></picture>`
}

/**
 * The comment's snapshot section: before and after thumbnails where their
 * images were published, else a link to the snapshots artifact.
 */
export function snapshotSection(index, {images, artifactUrl} = {}) {
  const files = index?.snapshots ?? []
  const ids = [...new Set(files.map(file => file.id))]
  if (!ids.length) return []
  const url = name => images?.[name]
  const published = files.every(file => url(file.path))
  if (!published) {
    return artifactUrl ? ['', `Snapshots of ${ids.map(id => `\`${id}\``).join(', ')} are in the [snapshots artifact](${artifactUrl}).`] : []
  }
  const lines = ['', '#### Snapshots']
  for (const id of ids) {
    const cell = side => {
      const light = files.find(file => file.id === id && file.side === side && file.theme === 'light')
      const dark = files.find(file => file.id === id && file.side === side && file.theme === 'dark')
      return light ? picture(url(light.path), dark && url(dark.path), `${id} ${side}`) : '—'
    }
    lines.push('', `**\`${id}\`**`, '', '| Before | After |', '| :---: | :---: |', `| ${cell('before')} | ${cell('after')} |`)
  }
  return lines
}

/** The workflow file of a run from its `GITHUB_WORKFLOW_REF` (`owner/repo/.github/workflows/ci.yml@refs/heads/main`). */
export function workflowPath(workflowRef, repository) {
  const prefix = `${repository}/`
  if (!workflowRef?.toLowerCase().startsWith(prefix.toLowerCase())) return undefined
  const file = workflowRef.slice(prefix.length).split('@')[0]
  return /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(file) ? file : undefined
}

/**
 * The runs whose artifact may hold a commit's extractions, newest first: successful runs from the Actions API's
 * `workflow_runs` for that `head_sha` that are the repository's own runs of `workflow` (this run's workflow file), for
 * a push or a pull request whose head is the repository itself. A fork's pull request runs its own workflow files, so
 * its artifact is never reused.
 */
export function artifactRuns(response, {repository, workflow}) {
  const runs = Array.isArray(response?.workflow_runs) ? response.workflow_runs : []
  const same = name => typeof name === 'string' && name.toLowerCase() === repository.toLowerCase()
  return runs
    .filter(run => Number.isSafeInteger(run?.id) && run.id > 0 && (run.conclusion === undefined || run.conclusion === 'success'))
    .filter(run => ['push', 'pull_request'].includes(run.event) && same(run.repository?.full_name) && same(run.head_repository?.full_name))
    .filter(run => typeof run.path === 'string' && run.path.split('@')[0] === workflow)
    .toSorted((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .map(run => run.id)
}
