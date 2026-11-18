import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {cp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {executionEnvironment, pullRequestTools, runBounded, startBackend} from './process.mjs'
import {commit, fixture, legacyDefinition} from './repository.mjs'

const executable = fileURLToPath(new URL(`../dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
async function cli(cwd, args, env = executionEnvironment(process.env)) {
  return runBounded(executable, args, {label: 'Projections CLI', cwd, env, timeoutMs: 60_000})
}
async function failed(promise, pattern) {
  const error = await promise.then(
    () => assert.fail('Expected the CLI to fail'),
    error => error,
  )
  assert.match(error.message, pattern)
  return error.output.stdout
}

test('real CLI collects both sample languages, compares history, exports immutable artifacts and validates offline', async t => {
  const {root, before} = await fixture(t)
  const node = JSON.parse((await cli(root, ['show', before, '-p', 'services-node', '--trust', '--json'])).stdout)
  const python = JSON.parse((await cli(root, ['show', before, '-p', 'services-python', '--trust', '--json'])).stdout)
  assert.equal(node.digest, python.digest)
  assert.equal(node.extraction.entities.length, 2)
  const services = JSON.parse(await readFile(path.join(root, 'services.json'), 'utf8'))
  services.services.push({name: 'queue', language: 'Go', dependencies: []})
  services.services[1].dependencies.push('queue')
  await writeFile(path.join(root, 'services.json'), JSON.stringify(services))
  const after = commit(root)
  const comparison = JSON.parse((await cli(root, ['compare', `${before}..${after}`, '-p', 'services-node', '--trust', '--json'])).stdout)
  assert.equal(comparison.comparison.changes.filter(change => change.status === 'added').length, 2)
  assert.equal(comparison.comparator.id, 'default')
  const text = (await cli(root, ['compare', `${before}..${after}`, '-p', 'services-node', '--trust'])).stdout
  assert.match(text, /^Services \(Node\) \(projection services-node\)|projection services-node/m)
  assert.match(text, /Step 1 of \d/)
  assert.match(text, /Added entity/)
  assert.match((await cli(root, ['show', after, '-p', 'services-node', '--trust'])).stdout, /Showing commit [0-9a-f]{12}\./)
  const output = path.join(root, '..', `extraction-${path.basename(root)}.json`)
  t.after(() => rm(output, {force: true}))
  await cli(root, ['show', after, '-p', 'services-node', '--trust', '--output', output])
  assert.deepEqual(JSON.parse((await cli(root, ['validate', output, '--json'])).stdout), {valid: true, format: 'projections.extraction'})
  assert.equal(
    JSON.parse((await cli(root, ['compare', '--before-extraction', output, '--after-extraction', output, '--json'])).stdout).comparison
      .changes.length,
    0,
  )
  assert.match((await cli(root, ['compare', '--before-extraction', output, '--after-extraction', output])).stdout, /No changes\./)
  const bytes = await readFile(output)
  const saved = JSON.parse(bytes)
  assert.equal(saved.provenance.revision.commit, after)
  assert.equal(saved.provenance.revision.dirty, false)
  assert.match(saved.provenance.definitionDigest, /^sha256:[0-9a-f]{64}$/)
  assert.ok(saved.extraction.entities.every(entity => entity.evidence[0].source === 'services.json'))
  await assert.rejects(cli(root, ['show', before, '-p', 'services-node']), /--trust/)
})

test('one invalid definition is reported where it is wrong, and the others still list and check', async t => {
  const {root} = await fixture(t)
  await writeFile(path.join(root, '.github/projections/legacy.json'), legacyDefinition)
  commit(root)
  const listed = await failed(cli(root, ['list', '--json']), /1 definition file is invalid/)
  const document = JSON.parse(listed)
  assert.deepEqual(document.projections.map(item => item.id).sort(), ['services-node', 'services-python'])
  assert.equal(document.invalid.length, 1)
  const [invalid] = document.invalid
  assert.equal(invalid.id, 'legacy')
  assert.equal(invalid.path, '.github/projections/legacy.json')
  assert.equal(invalid.diagnostics[0].pointer, '/comparator/module')
  assert.deepEqual(invalid.diagnostics[0].location, {path: '.github/projections/legacy.json', line: 7, column: 5})
  assert.match(
    invalid.diagnostics[0].message,
    /^Module comparators were removed; name a comparator file instead: `"comparator": "<path>\.comparator\.yaml"`\. See https:\/\/github\.com\/githubnext\/projections\/blob\/main\/docs\/guides\/comparators\.md$/,
  )
  const text = await failed(cli(root, ['list']), /1 definition file is invalid/)
  assert.match(text, /services-node: /)
  assert.match(text, /legacy: invalid: \.github\/projections\/legacy\.json:7:5: Module comparators were removed/)

  const checked = JSON.parse(await failed(cli(root, ['check', '--no-render', '--json']), /./))
  assert.equal(checked.ok, false)
  const legacy = checked.projections.find(item => item.id === 'legacy')
  assert.equal(legacy.steps[0].status, 'fail')
  assert.match(legacy.steps[0].message, /legacy\.json:7:5: Module comparators were removed/)
  assert.equal(legacy.diagnostics[0].pointer, '/comparator/module')
  // The valid projections are still checked (they run repository code, so their extraction needs --trust).
  assert.ok(checked.projections.some(item => item.id === 'services-node' && item.steps[0].status === 'pass'))
  // A projection the command names that is invalid fails with its diagnostic, not as unknown.
  await failed(cli(root, ['show', '-p', 'legacy']), /legacy\.json:7:5: Module comparators were removed/)
})

test('comparator files run in the embedded interpreter, deterministically', async t => {
  const {root} = await fixture(t)
  await mkdir(path.join(root, 'tools'))
  await cp(
    fileURLToPath(new URL('../../../examples/comparators/priority-order/priority-order.comparator.yaml', import.meta.url)),
    path.join(root, 'tools/order.comparator.yaml'),
  )
  await writeFile(
    path.join(root, '.github/projections/services-ordered.json'),
    JSON.stringify({
      id: 'services-ordered',
      title: 'Services, queue first',
      extractor: {command: ['node', 'collect.mjs'], sources: ['collect.mjs']},
      renderer: 'architecture',
      comparator: {file: 'tools/order.comparator.yaml', options: {priority: ['service:queue']}},
    }),
  )
  const before = commit(root)
  const services = JSON.parse(await readFile(path.join(root, 'services.json'), 'utf8'))
  services.services.push({name: 'queue', language: 'Go', dependencies: []})
  services.services[1].dependencies.push('queue')
  await writeFile(path.join(root, 'services.json'), JSON.stringify(services))
  const after = commit(root)
  const run = async () =>
    JSON.parse((await cli(root, ['compare', `${before}..${after}`, '-p', 'services-ordered', '--trust', '--json'])).stdout)
  const first = await run()
  assert.equal(first.comparator.id, 'tools/order.comparator.yaml')
  assert.match(first.comparator.digest, /^sha256:[0-9a-f]{64}$/)
  // Each extraction records when it ran; everything else is identical.
  const withoutTimes = document => {
    for (const side of [document.before, document.after]) delete side.provenance.execution?.at
    return document
  }
  assert.deepEqual(withoutTimes(await run()), withoutTimes(structuredClone(first)))
  assert.ok(first.comparison.steps.length > 0)
  // Rules that fail are an explicit failure, never the baseline.
  await writeFile(
    path.join(root, 'tools/order.comparator.yaml'),
    'format: projections.comparator\nversion: 0\nchecks:\n  - assert: size(options) > 99\n    message: "\'refused\'"\n',
  )
  await failed(cli(root, ['compare', before, '-p', 'services-ordered', '--trust', '--definition', 'head']), /refused/)
})

test('extractor list/init work without execution; invalid flags, duplicate output paths and implicit trust fail explicitly', async t => {
  const {root} = await fixture(t)
  const catalog = JSON.parse((await cli(root, ['extractor', 'list', '--json'])).stdout)
  assert.deepEqual(
    catalog.extractors.map(extractor => extractor.id),
    [
      'workspace-dependencies',
      'repository-map',
      'typescript-public-api',
      'rust-public-api',
      'go-public-api',
      'cargo-dependencies',
      'nuget-dependencies',
      'terraform-infrastructure',
      'azure-what-if',
      'github-actions-jobs',
      'github-agentic-workflows',
      'tetragon-policies',
      'dotnet-public-api',
      'dotnet-di',
      'nestjs-di',
      'spring-di',
      'efcore-schema',
      'django-schema',
      'code-statistics',
      'prisma-schema',
      'rails-schema',
      'rails-routes',
      'scip-file-references',
      'command-output',
    ],
  )
  await cli(root, ['init', 'files', '--extractor', 'repository-map'])
  const definition = JSON.parse(await readFile(path.join(root, '.github/projections/files.json'), 'utf8'))
  assert.equal(definition.extractor, 'repository-map')
  await cli(root, ['init', 'custom', '--command', JSON.stringify([process.execPath, 'collect.mjs'])])
  const custom = JSON.parse(await readFile(path.join(root, '.github/projections/custom.json'), 'utf8'))
  assert.deepEqual(custom.extractor.command, [process.execPath, 'collect.mjs'])
  await assert.rejects(cli(root, ['init', 'files']), /already exists/)
  await assert.rejects(cli(root, ['extractor', 'list', '--trust']), /unexpected argument/)
  await assert.rejects(cli(root, ['compare', '-p', 'services-node', '--trust']), /revisions to compare/)
  await assert.rejects(cli(root, ['compare', 'HEAD', '-p', 'services-node', '--all']), /cannot be used with '--all'/)
  const listed = JSON.parse((await cli(root, ['list', '--json'])).stdout)
  assert.deepEqual(
    listed.projections.map(item => [item.id, item.requiresTrust]),
    [
      ['custom', true],
      ['files', false],
      ['services-node', true],
      ['services-python', true],
    ],
  )
  await assert.rejects(cli(root, ['show', '-p', 'services-node', '--before', 'HEAD']), /unexpected argument/)
  for (const removed of ['collect', 'collect-all', 'compare-all', 'compare-bookmarks', 'catalog', 'bookmarks', 'review', 'snapshot'])
    await assert.rejects(cli(root, [removed]), /unrecognized subcommand/)
})

test('a saved document is served over stdio without running extractors', async t => {
  const {root, before} = await fixture(t)
  const extraction = (await cli(root, ['show', before, '-p', 'services-node', '--trust', '--json'])).stdout
  const file = path.join(root, 'review.json')
  await writeFile(file, extraction)
  const backend = await startBackend(executable, ['--document', file], {cwd: root, env: executionEnvironment(process.env)})
  t.after(() => backend.close())
  assert.equal(backend.info.mode, 'document')
  assert.equal((await backend.request('GET', '/api/document')).body.document.format, 'projections.extraction')
  assert.equal((await backend.request('POST', '/api/jobs', {projectionId: 'services-node', before: 'HEAD'})).status, 403)
  // The local web app is gone: the extension is the Inspector's host.
  await assert.rejects(cli(root, ['inspect']), /unrecognized subcommand/)
  await assert.rejects(cli(root, ['explore', '--web']), /unexpected argument/)
})

test('batch CLI preserves successful items, explicit unknown IDs and saved working-tree scenarios', async t => {
  const {root, before} = await fixture(t)
  const shown = JSON.parse((await cli(root, ['show', '--all', '--trust', '--json'])).stdout)
  assert.deepEqual(
    shown.results.map(item => [item.id, item.status]),
    [
      ['services-node', 'extracted'],
      ['services-python', 'extracted'],
    ],
  )
  const untrusted = JSON.parse(await failed(cli(root, ['show', '--all', '--json']), /2 of the batch's items failed/))
  assert.deepEqual(
    untrusted.results.map(item => [item.diagnostics[0].code, item.definition.id]),
    [
      ['TRUST_REQUIRED', 'services-node'],
      ['TRUST_REQUIRED', 'services-python'],
    ],
  )
  await writeFile(
    path.join(root, '.projections-bookmarks.json'),
    JSON.stringify({
      format: 'projections.bookmarks',
      version: 0,
      bookmarks: [{id: 'working', title: 'Review working files', projectionId: 'services-node', before}],
    }),
  )
  assert.equal(JSON.parse((await cli(root, ['bookmark', 'list', '--json'])).stdout).bookmarks[0].after, 'working-tree')
  const saved = JSON.parse((await cli(root, ['bookmark', 'run', '--trust', '--json'])).stdout)
  assert.equal(saved.results[0].status, 'unchanged')
  assert.equal(saved.results[0].comparison.after.provenance.revision.kind, 'working-tree')
  const missing = JSON.parse(
    await failed(cli(root, ['bookmark', 'run', 'working', 'missing', '--trust', '--json']), /1 of the batch's items failed/),
  )
  assert.deepEqual(
    missing.results.map(item => [item.id, item.status]),
    [
      ['working', 'unchanged'],
      ['missing', 'error'],
    ],
  )
  assert.match((await cli(root, ['bookmark', 'run', '--trust'])).stdout, /== working ==[\s\S]*No changes\./)
  assert.equal(JSON.parse((await cli(root, ['compare', `${before}..${before}`, '--all', '--trust', '--json'])).stdout).results.length, 2)
})

test(
  'native PR review stays untrusted and saves verifiable comparisons',
  // On Windows the CLI runs gh.exe and git.exe, which /bin/sh stand-ins can't replace; the Rust suites' PR tests too.
  {skip: process.platform === 'win32' && 'Stands in for gh and git with /bin/sh scripts'},
  async t => {
    const {root} = await fixture(t)
    await cli(root, ['init', 'files', '--extractor', 'repository-map'])
    const base = commit(root)
    await writeFile(path.join(root, 'new.txt'), 'changed')
    const head = commit(root)
    const tools = path.join(root, '..', `pr-tools-${path.basename(root)}`)
    await mkdir(tools)
    t.after(() => rm(tools, {recursive: true, force: true}))
    await pullRequestTools(tools, {
      gitPath: await realpath(execFileSync('which', ['git'], {encoding: 'utf8'}).trim()),
      repository: root,
      base,
      head,
      metadata: {
        html_url: 'https://github.com/example/tiny/pull/42',
        base: {sha: base, repo: {id: 1, full_name: 'example/tiny'}},
        head: {sha: head, repo: {id: 2, full_name: 'example/fork'}},
      },
    })
    const env = {...executionEnvironment(process.env), PATH: `${tools}${path.delimiter}${process.env.PATH}`}
    const cache = path.join(tools, 'cache')
    await mkdir(cache)
    const review = JSON.parse(
      await failed(
        cli(root, ['pr', '42', '-R', 'example/tiny', '--cache', cache, '--id', 'files', '--id', 'services-node', '--json'], env),
        /1 of the pull request's comparisons failed/,
      ),
    )
    assert.equal(review.execution, 'untrusted')
    assert.equal(review.fork, true)
    assert.equal(review.site, undefined)
    assert.deepEqual(
      review.comparisons.results.map(item => item.status),
      ['changed', 'error'],
    )
    assert.equal(review.comparisons.results[1].diagnostics[0].code, 'TRUST_REQUIRED')
    await failed(cli(root, ['pr', '42', '-R', 'example/tiny', '--cache', cache, '--trust'], env), /unexpected argument/)
    const comparison = path.join(root, 'review.json')
    await writeFile(comparison, JSON.stringify(review.comparisons.results[0].comparison))
    assert.equal(JSON.parse((await cli(root, ['validate', comparison, '--json'])).stdout).format, 'projections.comparison')
    await failed(cli(root, ['site', '--document', `good=${comparison}`, '--directory', path.join(root, 'site')]), /unrecognized subcommand/)
  },
)
