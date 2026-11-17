import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Ajv2020} from 'ajv/dist/2020.js'
import {
  artifactManifest,
  artifactRuns,
  cliArguments,
  commentBody,
  commentMarker,
  eventSubject,
  expectedDigest,
  gitBlobSha,
  newestInMajor,
  releaseAsset,
  releaseTag,
  repositoryDirectory,
  sha256,
  snapshotIds,
  snapshotIndex,
  snapshotName,
  snapshotPlan,
  snapshotTarget,
  splitBatch,
  summaryMarkdown,
} from '../src/lib.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const cli = path.join(root, `packages/cli/dist/projections${process.platform === 'win32' ? '.exe' : ''}`)
// The built CLI's version: the release version every shipped manifest carries.
const {version: cliVersion} = JSON.parse(readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'))
const schema = JSON.parse(readFileSync(path.join(root, 'packages/schemas/schemas/artifact/v0.json'), 'utf8'))
const validateManifest = new Ajv2020({strict: true, strictTuples: false}).compile(schema)
const sha = character => character.repeat(40)

test('release assets follow GitHub CLI precompiled extension names; tags come from input or the action ref', () => {
  assert.equal(releaseAsset('Linux', 'X64'), 'gh-projections-linux-amd64')
  assert.equal(releaseAsset('macOS', 'ARM64'), 'gh-projections-darwin-arm64')
  assert.equal(releaseAsset('Windows', 'X64'), 'gh-projections-windows-amd64.exe')
  assert.throws(() => releaseAsset('Linux', 'ARM'), /build-from-source/)
  assert.equal(releaseTag('', 'v0.2.1'), 'v0.2.1')
  assert.equal(releaseTag('', 'main'), undefined)
  assert.equal(releaseTag('latest', 'v0.2.1'), undefined)
  assert.equal(releaseTag('0.3.0', 'v0.2.1'), 'v0.3.0')
  assert.throws(() => releaseTag('v1; rm -rf /', ''), /version must be/)
  // uses: …@v0 and @v0.1.0; @latest, a branch or a commit SHA install the latest release.
  assert.equal(releaseTag('', 'v0'), 'v0')
  assert.equal(releaseTag('', 'v0.1.0'), 'v0.1.0')
  assert.equal(releaseTag('', 'latest'), undefined)
  assert.equal(releaseTag('', ''), undefined)
  assert.equal(releaseTag(undefined, undefined), undefined)
  assert.equal(releaseTag('', sha('a')), undefined)
  assert.equal(releaseTag('v0', 'v1.0.0'), 'v0')
  assert.equal(releaseTag('1', ''), 'v1')
  const sums = `${'a'.repeat(64)}  gh-projections-linux-amd64\n${'b'.repeat(64)} *gh-projections-darwin-arm64\n`
  assert.equal(expectedDigest(sums, 'gh-projections-darwin-arm64'), 'b'.repeat(64))
  assert.throws(() => expectedDigest(sums, 'gh-projections-windows-amd64.exe'), /exactly once/)
  assert.throws(() => expectedDigest(sums + sums, 'gh-projections-linux-amd64'), /exactly once/)
})

test('a major tag installs its newest stable release, never a prerelease, draft or later major', () => {
  const releases = [
    {tagName: 'v1.0.0', isDraft: false, isPrerelease: false},
    {tagName: 'v0.10.0-beta.1', isDraft: false, isPrerelease: true},
    {tagName: 'v0.9.0', isDraft: true, isPrerelease: false},
    {tagName: 'v0.2.0', isDraft: false, isPrerelease: false},
    {tagName: 'v0.10.1', isDraft: false, isPrerelease: false},
    {tagName: 'v0.10.0', isDraft: false, isPrerelease: false},
    {tagName: 'v0', isDraft: false, isPrerelease: false},
  ]
  assert.equal(newestInMajor(releases, 'v0'), 'v0.10.1')
  assert.equal(newestInMajor(releases, 'v1'), 'v1.0.0')
  assert.throws(() => newestInMajor(releases, 'v2'), /No stable v2\.x\.y release/)
  assert.throws(() => newestInMajor([{tagName: 'v3.0.0-rc.1', isDraft: false, isPrerelease: true}], 'v3'), /No stable/)
})

test('events: pull_request compares merge base to head with the base definition; push shows one commit; others are refused', () => {
  const subject = eventSubject('pull_request', {pull_request: {number: 7, base: {sha: sha('a')}, head: {sha: sha('b')}}})
  assert.deepEqual(subject, {kind: 'pull-request', number: 7, base: sha('a'), head: sha('b')})
  assert.deepEqual(cliArguments({...subject, mergeBase: sha('c')}, {trust: false, output: '/tmp/x.json', artifacts: ['/tmp/base']}), [
    'compare',
    `${sha('c')}..${sha('b')}`,
    '--all',
    '--definition',
    'base',
    '--json',
    '--output',
    '/tmp/x.json',
    '--in-place',
    '--artifact',
    '/tmp/base',
  ])
  assert.deepEqual(cliArguments({kind: 'push', ref: 'refs/heads/main', revision: sha('d')}, {trust: true, output: 'o'}), [
    'show',
    '--all',
    sha('d'),
    '--json',
    '--output',
    'o',
    '--trust',
    '--in-place',
  ])
  assert.deepEqual(
    artifactRuns({
      workflow_runs: [
        {id: 1, created_at: '2026-01-01T00:00:00Z', conclusion: 'success'},
        {id: 2, created_at: '2026-01-02T00:00:00Z', conclusion: 'success'},
        {id: 3, created_at: '2026-01-03T00:00:00Z', conclusion: 'failure'},
        {id: 'x'},
      ],
    }),
    [2, 1],
  )
  assert.deepEqual(eventSubject('push', {after: sha('d')}, 'refs/heads/main'), {kind: 'push', ref: 'refs/heads/main', revision: sha('d')})
  assert.throws(() => eventSubject('push', {after: '0'.repeat(40)}, 'refs/heads/main'), /deleted/)
  assert.throws(() => eventSubject('pull_request_target', {}), /secrets/)
  assert.throws(() => eventSubject('pull_request', {pull_request: {number: 7, base: {sha: 'main'}, head: {sha: sha('b')}}}), /base or head/)
})

test('a batch splits into one verified document per projection, error items keep bounded diagnostics, and the comment summarizes them', () => {
  const subject = {kind: 'pull-request', number: 7, base: sha('a'), head: sha('b'), mergeBase: sha('c')}
  const comparison = {format: 'projections.comparison', version: 0}
  const batch = {
    format: 'projections.batch',
    version: 0,
    operation: 'compare',
    failed: 1,
    results: [
      {id: 'services', status: 'changed', comparison, notices: []},
      {
        id: 'flags',
        status: 'error',
        definition: {title: 'Feature flags'},
        diagnostics: [{severity: 'error', code: 'TRUST_REQUIRED', path: '', message: 'x'.repeat(5000)}],
      },
      {
        id: 'routes',
        status: 'head-only',
        extraction: {format: 'projections.extraction'},
        notices: ['Projection routes is not defined at the base revision'],
      },
    ],
  }
  const options = {
    subject,
    repository: {id: 1, owner: 'octo-org', name: 'delivery'},
    run: {id: 10, attempt: 2},
    cli: 'projections 0.0.0',
    action: 'githubnext/projections@v0',
    trust: false,
  }
  const {manifest, files} = splitBatch(batch, options)
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors))
  assert.deepEqual([...files.keys()].sort(), [artifactManifest, 'projections/routes.json', 'projections/services.json'])
  assert.equal(manifest.projections[0].sha256, sha256(files.get('projections/services.json')))
  assert.equal(manifest.projections[1].title, 'Feature flags')
  assert.equal(manifest.projections[1].diagnostics[0].message.length, 4096)
  assert.equal(manifest.projections[0].notices, undefined)
  assert.throws(() => splitBatch({...batch, operation: 'show'}, options), /compare batch/)
  assert.throws(() => splitBatch({...batch, results: [{id: '../x', status: 'changed', comparison}]}, options), /Invalid/)
  assert.throws(
    () => splitBatch({...batch, results: [{id: 'a', status: 'changed', extraction: {format: 'projections.extraction'}}]}, options),
    /no projections.comparison/,
  )
  assert.throws(
    () => splitBatch({...batch, results: Array.from({length: 61}, (_, index) => ({id: `p${index}`, status: 'error'}))}, options),
    /At most 60/,
  )
  const documents = new Map(
    [...files].filter(([file]) => file !== artifactManifest).map(([file, bytes]) => [file.slice(12, -5), JSON.parse(bytes)]),
  )
  const body = commentBody(manifest, documents)
  assert.ok(body.startsWith(commentMarker))
  assert.match(body, /1 changed, 1 failed, 1 new in this pull request/)
  assert.match(body, /<strong>Feature flags<\/strong> \(<code>flags<\/code>\): failed/)
  assert.match(body, /- `TRUST_REQUIRED`: x{100}/)
  // A hosted view is linked only when one is configured.
  assert.doesNotMatch(body, /https?:\/\//)
  assert.match(
    commentBody(manifest, documents, {hostedUrl: 'https://projections.example/'}),
    /\[View them on projections\.example\]\(https:\/\/projections\.example\/octo-org\/delivery\/pull\/7\)/,
  )
  assert.throws(() => commentBody(manifest, documents, {hostedUrl: 'javascript:alert(1)'}), /http\(s\) origin/)
})

test('the summary tells each comparison in steps and changes, escapes repository text and fits the limit', () => {
  const entity = (id, label) => ({id, kind: 'service', label})
  const before = {
    projection: {id: 'services', title: 'Services'},
    extraction: {entities: [entity('orders', 'Orders'), entity('billing', '@octocat <img src=x>')], relationships: []},
  }
  const after = {
    projection: {id: 'services', title: 'Services'},
    extraction: {
      entities: [entity('orders', 'Orders'), entity('payments', 'Pay`ments'), entity('cache', 'Cache')],
      relationships: [{id: 'orders->payments', kind: 'calls', from: 'orders', to: 'payments'}],
    },
  }
  const comparison = {
    changes: [
      {id: 'billing', collection: 'entities', before: ['billing'], after: [], status: 'removed', correspondence: 'none'},
      {
        id: 'payments',
        collection: 'entities',
        before: [],
        after: ['payments'],
        status: 'added',
        correspondence: 'none',
        summary: 'Split out of *orders* [link](https://x.invalid)',
      },
      {id: 'cache', collection: 'entities', before: [], after: ['cache'], status: 'added', correspondence: 'none'},
      {
        id: 'orders->payments',
        collection: 'relationships',
        before: [],
        after: ['orders->payments'],
        status: 'added',
        correspondence: 'none',
      },
    ],
    steps: [
      {kind: 'remove', changes: ['billing'], summary: 'Legacy billing retires'},
      {kind: 'add', changes: ['payments', 'orders->payments']},
      {changes: ['cache']},
    ],
  }
  const manifest = {
    repository: {owner: 'octo-org', name: 'delivery'},
    subject: {kind: 'pull-request', number: 7, mergeBase: sha('c'), head: sha('b')},
    run: {id: 10},
    trust: true,
    projections: [
      {id: 'services', status: 'changed', path: 'projections/services.json'},
      {id: 'files', status: 'unchanged', path: 'projections/files.json'},
    ],
  }
  const documents = new Map([
    ['services', {before, after, comparison}],
    ['files', {before: {projection: {title: 'Files'}}, after: {}, comparison: {changes: [], steps: []}}],
  ])
  const text = summaryMarkdown(manifest, documents)
  assert.match(text, /^### Projections\n\nCompared `ccccccc` \(merge base\) with `bbbbbbb` for pull request #7: 1 changed, 1 unchanged\./)
  assert.match(text, /\| `services` \| Changed: 4 changes in 3 steps: 3 added, 1 removed \|/)
  assert.match(text, /\| `files` \| Unchanged: no changes \|/)
  assert.match(
    text,
    /<details><summary><strong>Services<\/strong> \(<code>services<\/code>\): changed, 4 changes in 3 steps: 3 added, 1 removed<\/summary>/,
  )
  assert.match(text, /^1\. \*\*Step 1 of 3\*\* \(remove\): Legacy billing retires$/m)
  assert.match(text, /^ {3}- Removed entity `@\u2060octocat <img src=x>` \(`billing`\)$/m)
  assert.match(
    text,
    /^ {3}- Added entity ``Pay`ments`` \(`payments`\): Split out of \\\*orders\\\* \\\[link\\\]\\\(https:\/\/x\.invalid\\\)$/m,
  )
  assert.match(text, /^ {3}- Added relationship `Orders` \(`orders`\) calls ``Pay`ments`` \(`payments`\)$/m)
  assert.match(text, /^3\. \*\*Step 3 of 3\*\*$/m)
  // An unchanged projection has nothing to detail.
  assert.doesNotMatch(text, /<strong>Files<\/strong>/)
  assert.match(text, /\*\*Projections: Open Artifact…\*\* in VS Code, or run `projections pr 7` in a clone\./)
  assert.match(text, /extractors that run repository code were trusted/)
  assert.doesNotMatch(text, /@octocat/)
  // Details that don't fit are left out, never cut mid-way.
  const short = summaryMarkdown(manifest, documents, {limit: 900})
  assert.ok(Buffer.byteLength(short) <= 900, String(Buffer.byteLength(short)))
  assert.match(short, /The details of 1 projection didn't fit here\./)
  assert.match(short, /\| `services` \| Changed/)
  // A push lists its extractions.
  const push = summaryMarkdown(
    {
      ...manifest,
      subject: {kind: 'push', ref: 'refs/heads/main', revision: sha('d')},
      projections: [{id: 'services', status: 'extracted', path: 'x'}],
    },
    new Map([['services', after]]),
    {hostedUrl: 'https://projections.example'},
  )
  assert.match(
    push,
    /Extracted `ddddddd` \(`refs\/heads\/main`\): 1 extracted\. \[View them on projections\.example\]\(https:\/\/projections\.example\/octo-org\/delivery\/commit\/d{40}\)\./,
  )
  assert.match(push, /\| `services` \| Extracted: 3 entities, 1 relationship \|/)
  assert.match(push, /`projections show --all dddddddddddd`/)
})

function git(cwd, ...args) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'})
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repository() {
  const directory = mkdtempSync(path.join(tmpdir(), 'projections-action-'))
  const repo = path.join(directory, 'repo')
  mkdirSync(path.join(repo, '.github/projections'), {recursive: true})
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  writeFileSync(path.join(repo, 'README.md'), '# Delivery\n')
  writeFileSync(
    path.join(repo, '.github/projections/files.json'),
    JSON.stringify({id: 'files', title: 'Files', extractor: 'repository-map', renderer: 'file-packing'}),
  )
  // A command extractor runs repository code, so without --trust it is a per-projection failure.
  writeFileSync(
    path.join(repo, '.github/projections/flags.json'),
    JSON.stringify({id: 'flags', title: 'Feature flags', extractor: {command: ['python3', 'flags.py']}, renderer: 'graph'}),
  )
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-qb', 'feature')
  mkdirSync(path.join(repo, 'src'))
  writeFileSync(path.join(repo, 'src/delivery.ts'), 'export const delivery = true\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'head')
  return {directory, repo, base, head: git(repo, 'rev-parse', 'HEAD')}
}
function collect(directory, repo, eventName, event, ref = 'refs/pull/7/merge', extra = {}) {
  const eventPath = path.join(directory, 'event.json')
  const outputs = path.join(directory, 'outputs.txt')
  writeFileSync(eventPath, JSON.stringify(event))
  writeFileSync(outputs, '')
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/collect.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      RUNNER_TEMP: directory,
      PROJECTIONS_CLI: cli,
      INPUT_TRUST: 'false',
      INPUT_WORKING_DIRECTORY: repo,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: ref,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md'),
      GITHUB_REPOSITORY: 'octo-org/delivery',
      GITHUB_REPOSITORY_ID: '42',
      GITHUB_RUN_ID: '1001',
      GITHUB_RUN_ATTEMPT: '1',
      ACTION_REPOSITORY: 'githubnext/projections',
      ACTION_REF: 'v0',
      PROJECTIONS_CACHE_DIR: path.join(directory, 'cache'),
      ...extra,
    },
  })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  return {
    stdout: result.stdout,
    outputs: Object.fromEntries(
      readFileSync(outputs, 'utf8')
        .trim()
        .split('\n')
        .map(line => line.split(/=(.*)/s).slice(0, 2)),
    ),
  }
}

test('the collect script runs the real CLI on a pull request: merge base to head, base definition, untrusted', t => {
  const {directory, repo, base, head} = repository()
  // The PR's base branch moved on after the branch point; the merge base is still the comparison's start.
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(path.join(repo, 'CHANGELOG.md'), 'later\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'later base')
  const movedBase = git(repo, 'rev-parse', 'HEAD')
  t.diagnostic(`base ${base} head ${head}`)
  const {outputs, stdout} = collect(directory, repo, 'pull_request', {pull_request: {number: 7, base: {sha: movedBase}, head: {sha: head}}})
  assert.equal(outputs.failed, '1')
  assert.equal(outputs.projections, '2')
  assert.match(stdout, /::error title=Projection flags::TRUST_REQUIRED/)
  const artifact = outputs.directory
  assert.deepEqual(readdirSync(artifact).sort(), ['projections', artifactManifest])
  const manifest = JSON.parse(readFileSync(path.join(artifact, artifactManifest), 'utf8'))
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors))
  assert.deepEqual(manifest.subject, {kind: 'pull-request', number: 7, base: movedBase, head, mergeBase: base, definition: 'base'})
  assert.deepEqual(manifest.repository, {provider: 'github', id: 42, owner: 'octo-org', name: 'delivery'})
  assert.deepEqual(manifest.run, {id: 1001, attempt: 1})
  assert.equal(manifest.trust, false)
  assert.equal(manifest.producer.cli, `projections ${cliVersion}`)
  const [files, flags] = manifest.projections
  assert.equal(flags.status, 'error')
  assert.equal(flags.diagnostics[0].code, 'TRUST_REQUIRED')
  assert.equal(files.status, 'changed')
  const bytes = readFileSync(path.join(artifact, files.path))
  assert.equal(sha256(bytes), files.sha256)
  const document = JSON.parse(bytes)
  assert.equal(document.before.provenance.revision.commit, base)
  assert.equal(document.after.provenance.revision.commit, head)
  // The engine accepts the document exactly as uploaded.
  const validated = spawnSync(cli, ['validate', path.join(artifact, files.path)], {encoding: 'utf8'})
  assert.equal(validated.status, 0, validated.stderr)
  // The summary step reports the comparison from the saved documents alone.
  const summary = path.join(directory, 'summary.md')
  const written = spawnSync(process.execPath, [fileURLToPath(new URL('../src/summary.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: {PATH: process.env.PATH, PROJECTIONS_MANIFEST: outputs.manifest, GITHUB_STEP_SUMMARY: summary, INPUT_HOSTED_URL: ''},
  })
  assert.equal(written.status, 0, written.stderr)
  const text = readFileSync(summary, 'utf8')
  assert.match(text, /Compared `[0-9a-f]{7}` \(merge base\) with `[0-9a-f]{7}` for pull request #7: 1 changed, 1 failed\./)
  assert.match(text, /\| `files` \| Changed: \d+ changes? in \d+ steps?/)
  assert.match(text, /^ {3}- Added entity .*delivery\.ts/m)
  assert.match(text, /- `TRUST_REQUIRED`: /)
  assert.doesNotMatch(text, /https?:\/\//)
})

test('the collect script shows every projection of a pushed commit', () => {
  const {directory, repo, head} = repository()
  const {outputs} = collect(directory, repo, 'push', {after: head}, 'refs/heads/feature')
  const manifest = JSON.parse(readFileSync(outputs.manifest, 'utf8'))
  assert.equal(validateManifest(manifest), true)
  assert.deepEqual(manifest.subject, {kind: 'push', ref: 'refs/heads/feature', revision: head})
  assert.deepEqual(
    manifest.projections.map(value => [value.id, value.status]),
    [
      ['files', 'extracted'],
      ['flags', 'error'],
    ],
  )
  const extraction = JSON.parse(readFileSync(path.join(outputs.directory, manifest.projections[0].path), 'utf8'))
  assert.equal(extraction.provenance.revision.commit, head)
})

// gh stand-ins are /bin/sh scripts; on Windows a process finds only gh.exe, which a script can't stand in for.
const ghStandIn = {skip: process.platform === 'win32' && 'Stands in for gh with a /bin/sh script'}

test("the base side reuses the merge base's own CI artifact, which the base step downloads", ghStandIn, () => {
  const {directory, repo, base, head} = repository()
  // The merge base's push run published its extractions.
  git(repo, 'checkout', '-q', base)
  const published = collect(directory, repo, 'push', {after: base}, 'refs/heads/main').outputs.directory
  git(repo, 'checkout', '-q', head)
  const bin = path.join(directory, 'bin')
  mkdirSync(bin)
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh
case "$*" in
  *"actions/runs?head_sha=${base}"*) printf '%s' '{"workflow_runs":[{"id":555,"conclusion":"success","created_at":"2026-01-01T00:00:00Z"}]}' ;;
  *"actions/runs/555/artifacts"*) printf '%s' '{"artifacts":[{"name":"projections","expired":false}]}' ;;
  "run download 555 --repo octo-org/delivery --name projections --dir "*) cp -R '${published}/.' "$9" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  )
  chmodSync(path.join(bin, 'gh'), 0o755)
  const eventPath = path.join(directory, 'pr.json')
  writeFileSync(eventPath, JSON.stringify({pull_request: {number: 7, base: {sha: base}, head: {sha: head}}}))
  const outputs = path.join(directory, 'base-outputs.txt')
  writeFileSync(outputs, '')
  const downloaded = spawnSync(process.execPath, [fileURLToPath(new URL('../src/base.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: directory,
      INPUT_WORKING_DIRECTORY: repo,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: 'refs/pull/7/merge',
      GITHUB_REPOSITORY: 'octo-org/delivery',
      GITHUB_OUTPUT: outputs,
    },
  })
  assert.equal(downloaded.status, 0, downloaded.stderr + downloaded.stdout)
  assert.doesNotMatch(downloaded.stdout, /::warning/)
  const baseArtifact = readFileSync(outputs, 'utf8').match(/^directory=(.*)$/m)[1]
  // The comparison's base side is CI's official extraction; the head is extracted in place.
  const {outputs: collected} = collect(
    directory,
    repo,
    'pull_request',
    {pull_request: {number: 7, base: {sha: base}, head: {sha: head}}},
    undefined,
    {
      PROJECTIONS_BASE_ARTIFACT: baseArtifact,
    },
  )
  const manifest = JSON.parse(readFileSync(collected.manifest, 'utf8'))
  const files = manifest.projections.find(projection => projection.id === 'files')
  const document = JSON.parse(readFileSync(path.join(collected.directory, files.path), 'utf8'))
  assert.equal(document.before.provenance.execution.source, 'ci')
  assert.equal(document.before.provenance.execution.official, true)
  assert.equal(document.after.provenance.execution.source, 'local-git-objects')
})

test('without a base artifact, the base side runs in a workspace the environment prepares (trusted)', () => {
  const {directory, repo, base, head} = repository()
  // An extractor that needs installed dependencies, and the steps that install them.
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(path.join(repo, '.gitignore'), 'deps/\n')
  writeFileSync(path.join(repo, 'deps.lock'), 'one\n')
  writeFileSync(
    path.join(repo, '.github/projections/environment.json'),
    JSON.stringify({
      format: 'projections.environment',
      version: 0,
      prepare: [
        {
          id: 'install',
          run: [
            'node',
            '-e',
            "const fs = require('node:fs'); fs.mkdirSync('deps', {recursive: true}); fs.copyFileSync('deps.lock', 'deps/installed')",
          ],
          key: ['deps.lock'],
        },
      ],
    }),
  )
  writeFileSync(
    path.join(repo, '.github/projections/flags.json'),
    JSON.stringify({
      id: 'flags',
      // It reads the examined revision's installed dependencies through the request.
      extractor: {
        command: [
          process.execPath,
          '-e',
          `const request = JSON.parse(require('fs').readFileSync(0, 'utf8'))
           if (!require('fs').existsSync(require('path').join(request.repository.checkout, 'deps/installed'))) process.exit(9)
           process.stdout.write(JSON.stringify({protocolVersion: 0, schema: 'graph/v0', entities: [{id: 'flag', kind: 'flag', label: 'on'}], relationships: []}))`,
        ],
      },
      renderer: 'graph',
    }),
  )
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'environment')
  const prepared = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', 'feature')
  git(repo, 'merge', '-q', '--no-edit', 'main')
  const merged = git(repo, 'rev-parse', 'HEAD')
  // The head is CI's checkout: prepared there by the workflow, as tests would be.
  mkdirSync(path.join(repo, 'deps'))
  writeFileSync(path.join(repo, 'deps/installed'), 'one\n')
  const {outputs} = collect(
    directory,
    repo,
    'pull_request',
    {pull_request: {number: 7, base: {sha: prepared}, head: {sha: merged}}},
    undefined,
    {
      INPUT_TRUST: 'true',
    },
  )
  const manifest = JSON.parse(readFileSync(outputs.manifest, 'utf8'))
  const flags = manifest.projections.find(projection => projection.id === 'flags')
  assert.equal(flags.status, 'unchanged', JSON.stringify(flags))
  const document = JSON.parse(readFileSync(path.join(outputs.directory, flags.path), 'utf8'))
  // A tiny repository is copied fresh; a larger one gets a reused worktree.
  assert.match(document.before.provenance.execution.source, /^local-(workspace|materialized)$/)
  assert.deepEqual(
    document.before.provenance.execution.prepared.map(step => step.id),
    ['install'],
  )
  assert.equal(document.after.provenance.execution.source, 'local-in-place')
  assert.notEqual(base, prepared)
})

test('install verifies the release checksum before the attestation and refuses a mismatch', ghStandIn, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'projections-install-'))
  const bin = path.join(directory, 'bin')
  mkdirSync(bin)
  const log = path.join(directory, 'gh.log')
  const asset = releaseAsset(process.platform === 'darwin' ? 'macOS' : 'Linux', process.arch === 'arm64' ? 'ARM64' : 'X64')
  // A fake gh: `release download` supplies the real CLI as the asset; `attestation verify` succeeds.
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = release ]; then
  while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
  cp "${cli}" "$dir/${asset}"
  if [ -n "$FAKE_SUM" ]; then echo "$FAKE_SUM  ${asset}" > "$dir/${asset}.sha256"; else (cd "$dir" && shasum -a 256 ${asset} > ${asset}.sha256); fi
fi
`,
  )
  chmodSync(path.join(bin, 'gh'), 0o755)
  const install = extra =>
    spawnSync(process.execPath, [fileURLToPath(new URL('../src/install.mjs', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        RUNNER_OS: process.platform === 'darwin' ? 'macOS' : 'Linux',
        RUNNER_ARCH: process.arch === 'arm64' ? 'ARM64' : 'X64',
        ACTION_REF: 'v0.1.0',
        GITHUB_OUTPUT: path.join(directory, 'outputs'),
        ...extra,
      },
    })
  const installed = install({})
  assert.equal(installed.status, 0, installed.stderr)
  assert.ok(readFileSync(path.join(directory, 'outputs'), 'utf8').includes(`cli-version=projections ${cliVersion}\n`))
  const calls = readFileSync(log, 'utf8').trim().split('\n')
  assert.equal(
    calls[0],
    `release download v0.1.0 --repo githubnext/projections --pattern ${asset} --pattern ${asset}.sha256 --dir ${path.join(directory, 'projections-cli')} --clobber`,
  )
  assert.equal(calls[1], `attestation verify ${path.join(directory, 'projections-cli', asset)} --repo githubnext/projections`)
  writeFileSync(log, '')
  const mismatch = install({FAKE_SUM: '0'.repeat(64)})
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.stderr, /\.sha256 lists 0{64}/)
  assert.doesNotMatch(readFileSync(log, 'utf8'), /attestation/)
})

test('action.yml passes inputs through the environment, pins upload-artifact and keeps tokens away from extraction', async () => {
  const {parse} = await import('yaml')
  const action = parse(readFileSync(path.join(root, 'action.yml'), 'utf8'))
  assert.equal(action.runs.using, 'composite')
  for (const step of action.runs.steps) {
    if (step.run) assert.equal(step.run.includes('${{'), false, 'Expressions must enter through env, not shell text')
    if (step.uses) assert.match(step.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/)
  }
  // A composite action's run steps see its ref and repository only through these expressions, not GITHUB_ACTION_*.
  const install = action.runs.steps.find(step => step.id === 'install')
  assert.equal(install.env.ACTION_REF, '${{ github.action_ref }}')
  const collect = action.runs.steps.find(step => step.id === 'collect')
  assert.equal(collect.env.ACTION_REPOSITORY, '${{ github.action_repository }}')
  assert.equal(collect.env.ACTION_REF, '${{ github.action_ref }}')
  // The base step downloads with the token and runs nothing; the artifact reaches extraction as a directory.
  const base = action.runs.steps.find(step => step.id === 'base')
  assert.equal(base.env.GH_TOKEN, '${{ inputs.token }}')
  assert.equal(action.inputs['reuse-base-artifact'].default, 'true')
  assert.equal(action.runs.steps.find(step => step.id === 'collect').env.PROJECTIONS_BASE_ARTIFACT, '${{ steps.base.outputs.directory }}')
  // Neither extraction nor rendering (which runs renderer code in a browser) sees a token.
  for (const id of ['collect', 'snapshots']) {
    const step = action.runs.steps.find(step => step.id === id)
    assert.equal(
      Object.keys(step.env).some(name => /TOKEN/.test(name)),
      false,
    )
  }
  assert.equal(action.inputs.snapshots.default, '')
  assert.equal(action.inputs['snapshots-commit'].default, 'false')
  assert.equal(action.inputs['snapshots-branch'].default, '')
  // The summary and comment read saved documents only, and link a hosted view only when one is configured.
  const summary = action.runs.steps.find(step => step.id === 'summary')
  assert.equal(
    Object.keys(summary.env).some(name => /TOKEN/.test(name)),
    false,
  )
  assert.equal(action.inputs.summary.default, 'true')
  assert.equal(action.inputs.comment.default, 'false')
  assert.equal(action.inputs['hosted-url'].default, '')
  assert.doesNotMatch(action.description, /githubnext\.com/)
  // Snapshots go to their own artifact, so the artifact holds only the files its manifest lists.
  const upload = action.runs.steps.find(step => step.id === 'upload-snapshots')
  assert.equal(upload.with.name, '${{ inputs.artifact-name }}-snapshots')
  assert.equal(action.inputs.trust.default, 'false')
  assert.equal(action.inputs['artifact-name'].default, 'projections')
  const workflow = parse(readFileSync(path.join(root, 'examples/ci/projections.yml'), 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['pull_request', 'push'])
  assert.deepEqual(workflow.permissions, {contents: 'read', 'pull-requests': 'write'})
  const [checkout, projections] = workflow.jobs.projections.steps
  assert.deepEqual(checkout.with, {'fetch-depth': 0, 'persist-credentials': false})
  assert.equal(projections.uses, 'githubnext/projections@v0')
  assert.equal(projections.with.trust, undefined)
  for (const input of Object.keys(projections.with)) assert.ok(action.inputs[input], `examples/ci passes ${input}, which action.yml lacks`)
})

test('snapshots: listed IDs, file names, what each projection renders, and where snapshots may be committed', () => {
  assert.deepEqual(snapshotIds(' files,deps\nfiles  api '), ['files', 'deps', 'api'])
  assert.deepEqual(snapshotIds(''), [])
  assert.throws(() => snapshotIds('../x'), /invalid projection ID/)
  assert.throws(() => snapshotIds(Array.from({length: 21}, (_, index) => `p${index}`).join(',')), /at most 20/)
  assert.equal(snapshotName('files', undefined, 'dark'), 'files.dark.png')
  assert.equal(snapshotName('files', 'before', 'light'), 'files.before.light.png')
  const manifest = {
    projections: [
      {id: 'files', status: 'changed', path: 'projections/files.json'},
      {id: 'routes', status: 'head-only', path: 'projections/routes.json'},
      {id: 'old', status: 'base-only', path: 'projections/old.json'},
      {id: 'flags', status: 'error', diagnostics: []},
    ],
  }
  const plan = snapshotPlan(manifest, ['files', 'routes', 'old', 'flags', 'missing'])
  assert.deepEqual(plan.renders, [
    {id: 'files', side: 'before', path: 'projections/files.json', part: 'before'},
    {id: 'files', side: 'after', path: 'projections/files.json', part: 'after'},
    {id: 'routes', side: 'after', path: 'projections/routes.json'},
    {id: 'old', side: 'before', path: 'projections/old.json'},
  ])
  assert.deepEqual(
    plan.skipped.map(item => item.id),
    ['flags', 'missing'],
  )
  assert.deepEqual(snapshotPlan({projections: [{id: 'files', status: 'extracted', path: 'p.json'}]}, ['files']).renders, [
    {id: 'files', path: 'p.json'},
  ])
  assert.equal(repositoryDirectory('/docs/images/'), 'docs/images')
  for (const bad of ['', '../x', 'a/../b', '.git/hooks', 'a b']) assert.throws(() => repositoryDirectory(bad), /snapshots-path/)

  const push = {kind: 'push', ref: 'refs/heads/main', revision: sha('d')}
  const inputs = {commit: true, path: '.github/projections/snapshots', branch: '', message: ''}
  const event = {repository: {default_branch: 'main'}}
  assert.deepEqual(snapshotTarget(push, event, inputs, 'octo-org/delivery'), {
    branch: 'main',
    directory: '.github/projections/snapshots',
    expected: sha('d'),
    message: 'Update Projections snapshots',
  })
  assert.match(snapshotTarget({...push, ref: 'refs/heads/feature'}, event, inputs, 'o/r').reason, /default branch \(main\)/)
  assert.match(snapshotTarget(push, event, {...inputs, commit: false}, 'o/r').reason, /snapshots-commit/)
  const pull = {kind: 'pull-request', number: 7, base: sha('a'), head: sha('b'), mergeBase: sha('c')}
  const pullEvent = {
    repository: {default_branch: 'main'},
    pull_request: {base: {ref: 'main'}, head: {ref: 'feature', repo: {full_name: 'octo-org/delivery'}}},
  }
  assert.match(snapshotTarget(pull, pullEvent, inputs, 'octo-org/delivery').reason, /snapshots-branch/)
  const branch = {...inputs, branch: 'projections-snapshots'}
  assert.deepEqual(snapshotTarget(pull, pullEvent, branch, 'octo-org/delivery'), {
    branch: 'projections-snapshots',
    directory: 'pull/7',
    orphan: true,
    message: 'Projections snapshots for #7',
  })
  const fork = {...pullEvent, pull_request: {...pullEvent.pull_request, head: {ref: 'feature', repo: {full_name: 'someone/delivery'}}}}
  assert.match(snapshotTarget(pull, fork, branch, 'octo-org/delivery').reason, /forks/)
  for (const name of ['main', 'feature', '-x', 'a..b', 'a.lock', 'a b'])
    assert.throws(() => snapshotTarget(pull, pullEvent, {...inputs, branch: name}, 'octo-org/delivery'), /snapshots-branch/)
  // Git's own blob ID.
  const bytes = Buffer.from('snapshot\n')
  const directory = mkdtempSync(path.join(tmpdir(), 'projections-blob-'))
  writeFileSync(path.join(directory, 'file'), bytes)
  assert.equal(gitBlobSha(bytes), git(directory, 'hash-object', 'file'))
})

test('the pull request comment shows before and after snapshots, theme-aware, or links the snapshots artifact', () => {
  const manifest = {
    repository: {owner: 'octo-org', name: 'delivery'},
    subject: {kind: 'pull-request', number: 7, mergeBase: sha('c'), head: sha('b')},
    run: {id: 10},
    trust: false,
    projections: [
      {id: 'files', status: 'changed'},
      {id: 'routes', status: 'head-only'},
    ],
  }
  const snapshots = [
    ...['before', 'after'].flatMap(side => ['light', 'dark'].map(theme => ({id: 'files', side, theme}))),
    ...['light', 'dark'].map(theme => ({id: 'routes', side: 'after', theme})),
  ].map(file => ({...file, path: snapshotName(file.id, file.side, file.theme)}))
  const index = {snapshots}
  const images = Object.fromEntries(
    snapshots.map(file => [file.path, `https://github.com/octo-org/delivery/raw/${sha('e')}/pull/7/${file.path}`]),
  )
  const body = commentBody(manifest, new Map(), {snapshots: {index, images, artifactUrl: 'https://example.invalid/artifact'}})
  assert.match(body, /#### Snapshots/)
  assert.match(body, /\| Before \| After \|/)
  assert.match(
    body,
    /<picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+\/pull\/7\/files\.before\.dark\.png"><img src="[^"]+\/pull\/7\/files\.before\.light\.png" alt="files before" width="420"><\/picture>/,
  )
  // A projection new in the pull request has no before.
  assert.match(body, /\| — \| <picture>.*routes\.after\.light\.png.*\|/)
  assert.doesNotMatch(body, /snapshots artifact/)
  const linked = commentBody(manifest, new Map(), {snapshots: {index, artifactUrl: 'https://example.invalid/artifact'}})
  assert.match(linked, /Snapshots of `files`, `routes` are in the \[snapshots artifact\]\(https:\/\/example\.invalid\/artifact\)\./)
  assert.doesNotMatch(linked, /<picture>/)
  assert.equal(commentBody(manifest, new Map(), {snapshots: {index}}), commentBody(manifest, new Map()))
})

test('the snapshot script renders both sides of a pull request and a push, light and dark, with the real CLI', t => {
  const {directory, repo, base, head} = repository()
  const pull = collect(directory, repo, 'pull_request', {pull_request: {number: 7, base: {sha: base}, head: {sha: head}}})
  const run = (outputs, extra = {}) => {
    const results = path.join(directory, 'snapshot-outputs.txt')
    writeFileSync(results, '')
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/snapshot.mjs', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Where the CLI looks for Chrome or Edge on Windows, as the Action's own environment has them.
        ...Object.fromEntries(
          ['SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].flatMap(name =>
            process.env[name] ? [[name, process.env[name]]] : [],
          ),
        ),
        RUNNER_TEMP: directory,
        PROJECTIONS_CLI: cli,
        PROJECTIONS_MANIFEST: outputs.manifest,
        INPUT_SNAPSHOTS: 'files, flags',
        INPUT_TRUST: 'false',
        INPUT_WORKING_DIRECTORY: repo,
        GITHUB_OUTPUT: results,
        ...(process.env.PROJECTIONS_BROWSER ? {PROJECTIONS_BROWSER: process.env.PROJECTIONS_BROWSER} : {}),
        ...extra,
      },
    })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    const values = Object.fromEntries(
      readFileSync(results, 'utf8')
        .trim()
        .split('\n')
        .map(line => line.split(/=(.*)/s).slice(0, 2)),
    )
    return {result, values, index: JSON.parse(readFileSync(path.join(values.directory, snapshotIndex), 'utf8'))}
  }
  const first = run(pull.outputs)
  if (/No Chrome, Chromium or Microsoft Edge was found/.test(first.result.stdout) && !process.env.CI) {
    t.skip('no Chrome, Chromium or Edge is installed; set PROJECTIONS_BROWSER to run the snapshot tests')
    return
  }
  assert.match(first.result.stdout, /::warning title=Projection snapshot flags::No snapshot: the projection failed/)
  assert.equal(first.values.failed, '0', first.result.stdout)
  assert.equal(first.values.count, '4')
  assert.deepEqual(
    first.index.snapshots.map(file => file.path),
    ['files.before.light.png', 'files.before.dark.png', 'files.after.light.png', 'files.after.dark.png'],
  )
  assert.deepEqual(first.index.subject, JSON.parse(readFileSync(pull.outputs.manifest, 'utf8')).subject)
  const read = name => readFileSync(path.join(first.values.directory, name))
  for (const file of first.index.snapshots) {
    assert.ok(read(file.path).subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')))
    assert.equal(sha256(read(file.path)), file.sha256)
  }
  assert.ok(!read('files.before.light.png').equals(read('files.after.light.png')))
  assert.ok(!read('files.after.light.png').equals(read('files.after.dark.png')))
  // The artifact directory itself is unchanged: it holds only the files its manifest lists.
  assert.deepEqual(readdirSync(pull.outputs.directory).sort(), ['projections', artifactManifest])

  const push = collect(directory, repo, 'push', {after: head}, 'refs/heads/feature')
  // Snapshots render saved documents, so no extractor runs; trust lets a custom renderer, repository code, draw them.
  assert.doesNotMatch(first.result.stdout, /--trust/)
  const pushed = run(push.outputs, {INPUT_SNAPSHOTS: 'files', INPUT_TRUST: 'true'})
  assert.match(pushed.result.stdout, /^projections .* show --from .* --trust$/m)
  assert.deepEqual(
    pushed.index.snapshots.map(file => file.path),
    ['files.light.png', 'files.dark.png'],
  )
  assert.ok(existsSync(path.join(pushed.values.directory, 'files.dark.png')))
  // A missing browser is a per-snapshot warning, not a failed job.
  const missing = run(push.outputs, {INPUT_SNAPSHOTS: 'files', INPUT_BROWSER: path.join(directory, 'no-browser')})
  assert.equal(missing.values.count, '0')
  assert.equal(missing.values.failed, '2')
  assert.match(missing.result.stdout, /::warning title=Projection snapshot files::.*no-browser/)
})

/** An in-memory stand-in for the parts of GitHub's Git database API that publish.mjs uses. */
async function fakeGitHub({branches = {}, fail} = {}) {
  const blobs = new Map()
  const trees = new Map([['tree-0', new Map()]])
  const commits = new Map()
  const refs = new Map()
  for (const [branch, commit] of Object.entries(branches)) {
    commits.set(commit, {tree: 'tree-0', parents: []})
    refs.set(branch, commit)
  }
  let next = 1
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined
    const url = new URL(request.url, 'http://localhost')
    const route = url.pathname.replace(/^\/repos\/octo-org\/delivery/, '')
    requests.push({method: request.method, route, body, authorization: request.headers.authorization})
    const reply = (status, value) => {
      response.writeHead(status, {'content-type': 'application/json'})
      response.end(JSON.stringify(value ?? {}))
    }
    if (fail) return reply(fail)
    let match
    if (request.method === 'GET' && (match = /^\/git\/ref\/heads\/(.+)$/.exec(route))) {
      const sha = refs.get(decodeURIComponent(match[1]))
      return sha ? reply(200, {object: {sha}}) : reply(404)
    }
    if (request.method === 'GET' && (match = /^\/contents\/(.+)$/.exec(route))) {
      const tree = trees.get(commits.get(url.searchParams.get('ref'))?.tree)
      const blob = tree?.get(match[1].split('/').map(decodeURIComponent).join('/'))
      return blob ? reply(200, {sha: blob}) : reply(404)
    }
    if (request.method === 'GET' && (match = /^\/git\/commits\/(.+)$/.exec(route)))
      return reply(200, {tree: {sha: commits.get(match[1]).tree}})
    if (request.method === 'POST' && route === '/git/blobs') {
      const bytes = Buffer.from(body.content, 'base64')
      const sha = gitBlobSha(bytes)
      blobs.set(sha, bytes)
      return reply(201, {sha})
    }
    if (request.method === 'POST' && route === '/git/trees') {
      const tree = new Map(body.base_tree ? trees.get(body.base_tree) : [])
      for (const entry of body.tree) tree.set(entry.path, entry.sha)
      const sha = `tree-${next++}`
      trees.set(sha, tree)
      return reply(201, {sha})
    }
    if (request.method === 'POST' && route === '/git/commits') {
      const sha = String(next++).padStart(40, '0')
      commits.set(sha, {tree: body.tree, parents: body.parents, message: body.message})
      return reply(201, {sha})
    }
    if (request.method === 'PATCH' && (match = /^\/git\/refs\/heads\/(.+)$/.exec(route))) {
      refs.set(decodeURIComponent(match[1]), body.sha)
      return reply(200, {object: {sha: body.sha}})
    }
    if (request.method === 'POST' && route === '/git/refs') {
      refs.set(body.ref.replace(/^refs\/heads\//, ''), body.sha)
      return reply(201, {object: {sha: body.sha}})
    }
    reply(404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {url: `http://127.0.0.1:${server.address().port}`, refs, commits, trees, blobs, requests, close: () => server.close()}
}

function publish(api, directory, event, inputs) {
  const eventPath = path.join(directory, 'publish-event.json')
  const outputs = path.join(directory, 'publish-outputs.txt')
  writeFileSync(eventPath, JSON.stringify(event))
  writeFileSync(outputs, '')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/publish.mjs', import.meta.url))], {
      env: {
        PATH: process.env.PATH,
        GH_TOKEN: 'test-token',
        GITHUB_API_URL: api.url,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'octo-org/delivery',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputs,
        PROJECTIONS_SNAPSHOTS: directory,
        ...inputs,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => (stdout += data))
    child.stderr.on('data', data => (stderr += data))
    child.on('error', reject)
    child.on('exit', status =>
      resolve({
        status,
        stdout,
        stderr,
        outputs: Object.fromEntries(
          readFileSync(outputs, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => line.split(/=(.*)/s).slice(0, 2)),
        ),
      }),
    )
  })
}

function snapshotDirectory(subject, files) {
  const directory = mkdtempSync(path.join(tmpdir(), 'projections-publish-'))
  const snapshots = files.map(([name, content]) => {
    writeFileSync(path.join(directory, name), content)
    return {path: name, sha256: sha256(Buffer.from(content))}
  })
  writeFileSync(path.join(directory, snapshotIndex), JSON.stringify({format: 'projections.snapshots', version: 0, subject, snapshots}))
  return directory
}

test('publish commits snapshots to the default branch only when they changed and the branch has not moved', async () => {
  const revision = sha('d')
  const api = await fakeGitHub({branches: {main: revision}})
  try {
    const subject = {kind: 'push', ref: 'refs/heads/main', revision}
    const directory = snapshotDirectory(subject, [
      ['files.light.png', 'light'],
      ['files.dark.png', 'dark'],
    ])
    const event = {repository: {default_branch: 'main'}}
    const inputs = {INPUT_SNAPSHOTS_COMMIT: 'true', INPUT_SNAPSHOTS_PATH: 'docs/snapshots'}
    const first = await publish(api, directory, event, inputs)
    assert.equal(first.status, 0, first.stderr)
    const commit = api.refs.get('main')
    assert.notEqual(commit, revision)
    assert.deepEqual(api.commits.get(commit).parents, [revision])
    assert.equal(api.commits.get(commit).message, 'Update Projections snapshots')
    assert.deepEqual([...api.trees.get(api.commits.get(commit).tree).keys()].sort(), [
      'docs/snapshots/files.dark.png',
      'docs/snapshots/files.light.png',
    ])
    assert.equal(first.outputs.commit, commit)
    assert.ok(api.requests.every(request => request.authorization === 'Bearer test-token'))
    assert.ok(api.requests.some(request => request.method === 'PATCH' && request.body.force === false))
    // The branch has moved on (to the snapshot commit itself): nothing is committed over it.
    const moved = await publish(api, directory, event, inputs)
    assert.match(moved.stdout, /moved on/)
    assert.equal(api.refs.get('main'), commit)
    // Unchanged images make no commit.
    const again = await publish(
      api,
      snapshotDirectory({...subject, revision: commit}, [
        ['files.light.png', 'light'],
        ['files.dark.png', 'dark'],
      ]),
      event,
      inputs,
    )
    assert.match(again.stdout, /unchanged/)
    assert.equal(api.refs.get('main'), commit)
    // Other branches, and runs without snapshots-commit, never commit.
    const feature = await publish(
      api,
      snapshotDirectory({...subject, ref: 'refs/heads/feature'}, [['files.light.png', 'x']]),
      event,
      inputs,
    )
    assert.match(feature.stdout, /only for pushes to the default branch/)
    assert.equal(api.refs.get('main'), commit)
  } finally {
    api.close()
  }
})

test('publish puts pull request snapshots on a dedicated branch for the comment, never from forks, and a read-only token only warns', async () => {
  const api = await fakeGitHub()
  try {
    const subject = {kind: 'pull-request', number: 7, base: sha('a'), head: sha('b'), mergeBase: sha('c')}
    const directory = snapshotDirectory(subject, [
      ['files.before.light.png', 'before'],
      ['files.after.light.png', 'after'],
    ])
    const event = {
      repository: {default_branch: 'main'},
      pull_request: {base: {ref: 'main'}, head: {ref: 'feature', repo: {full_name: 'octo-org/delivery'}}},
    }
    const inputs = {INPUT_SNAPSHOTS_BRANCH: 'projections-snapshots'}
    const created = await publish(api, directory, event, inputs)
    assert.equal(created.status, 0, created.stderr)
    const commit = api.refs.get('projections-snapshots')
    assert.deepEqual(api.commits.get(commit).parents, [])
    const images = JSON.parse(created.outputs.images)
    assert.equal(images['files.after.light.png'], `https://github.com/octo-org/delivery/raw/${commit}/pull/7/files.after.light.png`)
    assert.ok(api.requests.some(request => request.method === 'POST' && request.route === '/git/refs'))
    const fork = await publish(
      api,
      directory,
      {...event, pull_request: {...event.pull_request, head: {ref: 'f', repo: {full_name: 'x/delivery'}}}},
      inputs,
    )
    assert.match(fork.stdout, /forks/)
    assert.equal(fork.outputs.images, undefined)
  } finally {
    api.close()
  }
  const denied = await fakeGitHub({fail: 403})
  try {
    const directory = snapshotDirectory({kind: 'push', ref: 'refs/heads/main', revision: sha('d')}, [['files.light.png', 'x']])
    const result = await publish(denied, directory, {repository: {default_branch: 'main'}}, {INPUT_SNAPSHOTS_COMMIT: 'true'})
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /::warning title=Projections snapshots::Could not commit the snapshots .*contents: write/)
  } finally {
    denied.close()
  }
})
