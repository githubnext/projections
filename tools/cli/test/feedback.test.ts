import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDraft,
  environmentText,
  FEEDBACK_LABEL,
  redact,
  redactPaths,
  redactSecrets,
  repositorySlug,
  similarity,
} from '../src/lib/feedback.ts'

// Home directories are assembled at runtime: check:boundaries rejects literal machine paths in the repository.
const home = ['', 'Users', 'someone'].join('/')
const otherHome = ['', 'home', 'other'].join('/')
const root = `${home}/src/projections`
const environment = {tools: '0.0.0', os: 'darwin 25.0.0 (arm64)', node: 'v26.12.1', rust: 'rustc 1.97.1', ref: 'main @ abc1234'}

test('absolute paths become repository-relative, and home directories ~', () => {
  assert.equal(redactPaths(`failed at ${root}/tools/cli/src/cli.ts:12:3`, root, home), 'failed at tools/cli/src/cli.ts:12:3')
  assert.equal(redactPaths(`cd ${root} && npm test`, root, home), 'cd . && npm test')
  assert.equal(redactPaths(`file://${root}/a.ts`, root, home), 'a.ts')
  assert.equal(redactPaths(`${home}/.cargo/bin/cargo`, root, home), '~/.cargo/bin/cargo')
  assert.equal(redactPaths(`${otherHome}/checkout/x and C:\\Users\\other\\x`, root, home), '~/checkout/x and ~\\x')
})

test('credential-like strings are removed', () => {
  const samples = [
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    'NPM npm_abcdefghijklmnopqrstuvwxyz0123456789AB',
    'Authorization: Bearer abc.def.ghi',
    'AKIAABCDEFGHIJKLMNOP',
    'key sk-proj-abcdefghijklmnopqrstuvwxyz',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'https://user:hunter22@example.com/repo.git',
    'NPM_TOKEN=abcdef123456 GITHUB_TOKEN: "zyxwvu987654" api_key=secretvalue',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ]
  const redacted = redactSecrets(samples.join('\n'))
  for (const secret of [
    'ghp_abc',
    'github_pat_11',
    'npm_abc',
    'abc.def.ghi',
    'AKIAABCD',
    'sk-proj',
    'eyJhbGci',
    'hunter22',
    'abcdef123456',
    'zyxwvu987654',
    'secretvalue',
    'MIIabc',
  ]) {
    assert.ok(!redacted.includes(secret), `${secret} leaked: ${redacted}`)
  }
  assert.match(redacted, /https:\/\/user:\[redacted\]@example\.com/)
  assert.match(redacted, /NPM_TOKEN=\[redacted\]/)
  // Ordinary text is untouched.
  assert.equal(redactSecrets('the token budget is 4000; tokens=12'), 'the token budget is 4000; tokens=12')
})

test('the repository comes from package.json repository, in any of its forms, or a remote URL', () => {
  assert.equal(repositorySlug({url: 'git+https://github.com/githubnext/projections.git'}), 'githubnext/projections')
  assert.equal(repositorySlug('github:owner/name'), 'owner/name')
  assert.equal(repositorySlug('git@github.com:owner/name.git'), 'owner/name')
  assert.equal(repositorySlug('https://github.com/owner/name'), 'owner/name')
  assert.equal(repositorySlug('https://gitlab.com/owner/name'), undefined)
  assert.equal(repositorySlug(undefined), undefined)
})

test('the draft: a title, the issue form headings, redacted fields and a prefilled URL', () => {
  const draft = buildDraft(
    {
      summary: '  tools check skipped docs  without saying why ',
      details: `Ran from ${root}`,
      command: 'npm run tools -- check --only docs',
      error: `Error: token ghp_abcdefghijklmnopqrstuvwxyz0123456789 at ${root}/scripts/x.mjs:3`,
    },
    environment,
    {repository: 'githubnext/projections', root, home},
  )
  assert.equal(draft.title, '[agent feedback] tools check skipped docs without saying why')
  assert.deepEqual(draft.labels, [FEEDBACK_LABEL])
  for (const heading of ['What were you trying to do?', 'Details', 'Command and inputs', 'Error', 'Environment']) {
    assert.ok(draft.body.includes(`### ${heading}\n\n`), heading)
  }
  assert.ok(draft.body.includes('```sh\nnpm run tools -- check --only docs\n```'))
  assert.ok(draft.body.includes('Ran from .'))
  assert.ok(!draft.body.includes(root) && !draft.body.includes('ghp_'))
  assert.ok(draft.body.includes(environmentText(environment)))
  const url = new URL(draft.url)
  assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/githubnext/projections/issues/new')
  assert.equal(url.searchParams.get('template'), 'agent-feedback.yml')
  assert.equal(url.searchParams.get('title'), draft.title)
  assert.equal(url.searchParams.get('labels'), FEEDBACK_LABEL)
  assert.equal(url.searchParams.get('command'), 'npm run tools -- check --only docs')
  assert.equal(url.searchParams.get('environment'), environmentText(environment))
})

test('missing fields read "No response", as GitHub writes them, and long fields are bounded', () => {
  const draft = buildDraft(
    {summary: 'x'.repeat(200), error: 'e'.repeat(5000)},
    {...environment, rust: undefined, ref: undefined},
    {repository: 'o/r', root, home},
  )
  assert.ok(draft.title.length <= 110)
  assert.match(draft.body, /### Details\n\n_No response_/)
  assert.match(draft.body, /more characters\)/)
  assert.match(draft.body, /- Rust: not installed/)
  assert.equal(new URL(draft.url).searchParams.get('details'), null)
})

test('redact composes both, and similar titles score high', () => {
  assert.equal(redact(`${root}/a token=abcdefghij`, root, home), 'a token=[redacted]')
  assert.ok(similarity('[agent feedback] tools check skips docs gate', 'tools check silently skips the docs gate') >= 0.5)
  assert.ok(similarity('tools check skips docs gate', 'feedback URL too long') < 0.2)
})
