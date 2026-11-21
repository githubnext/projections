// Unit tests of the side bar's model of a repository's projections, loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {byTitle, candidateReason, parseCandidates, parseDefinitions} from '../src/projections/definitions.ts'
import {changeCount, failureFor, parts, rendererIcon, statusText} from '../src/projections/rows.ts'
import {jobChangeCount, nextMode, pairLabel, refLabel, samePair, swapped} from '../src/projections/pairs.ts'
import {parsePairs} from '../src/projections/pair-list.ts'
import {parseProjectionQuery, projectionPath, projectionQuery} from '../src/projections/resources.ts'

const legacy = {
  id: 'legacy',
  path: '.github/projections/legacy.json',
  diagnostics: [
    {
      code: 'INVALID_DEFINITION',
      severity: 'error',
      message: 'Module comparators were removed; name a comparator file instead.',
      pointer: '/comparator/module',
      path: '.github/projections/legacy.json',
      location: {path: '.github/projections/legacy.json', line: 7, column: 5},
    },
  ],
}

test('definitions keep the valid ones beside the invalid ones, with where each is wrong', () => {
  const list = parseDefinitions({
    definitions: [{id: 'packages', title: 'Packages', extractor: 'workspace-dependencies', renderer: 'dependencies'}, {title: 'no id'}],
    policies: [{id: 'packages', requiresTrust: false, rendererRequiresTrust: false}],
    invalid: [legacy, {diagnostics: []}],
    executionAuthorized: false,
    ref: 'working-tree',
  })
  assert.deepEqual(
    list.definitions.map(item => item.id),
    ['packages'],
  )
  assert.equal(list.setup, false)
  assert.deepEqual(list.invalid, [
    {
      id: 'legacy',
      path: '.github/projections/legacy.json',
      diagnostics: [
        {
          code: 'INVALID_DEFINITION',
          message: 'Module comparators were removed; name a comparator file instead.',
          pointer: '/comparator/module',
          location: {path: '.github/projections/legacy.json', line: 7, column: 5},
        },
      ],
    },
  ])
  assert.equal(parseDefinitions({definitions: [], setup: {command: 'projections init <id>'}}).setup, true)
  assert.throws(() => parseDefinitions({}), /unexpected shape/)
  assert.deepEqual(failureFor(list.invalid[0]), {
    title: "legacy can't load: its definition is invalid",
    diagnostics: [
      {
        message: 'Module comparators were removed; name a comparator file instead.',
        path: '.github/projections/legacy.json',
        line: 7,
        column: 5,
      },
    ],
  })
})

test("a row's status: failed, needs trust, its tab's change count, or not compared yet", () => {
  const policy = {id: 'x', requiresTrust: true, rendererRequiresTrust: false}
  assert.equal(statusText({invalid: true, executionAuthorized: true}), 'failed')
  assert.equal(statusText({policy, executionAuthorized: false}), 'needs trust')
  assert.equal(statusText({policy, executionAuthorized: true}), 'not compared')
  const compared = changes => ({status: 'ok', comparison: {compared: true, rows: 9, changes}})
  assert.equal(statusText({executionAuthorized: false, summary: compared({added: 2, removed: 1, unchanged: 6})}), '3 changes')
  assert.equal(statusText({executionAuthorized: false, summary: compared({modified: 1})}), '1 change')
  assert.equal(statusText({executionAuthorized: false, summary: compared({unchanged: 9})}), 'no change')
  assert.equal(statusText({executionAuthorized: false, summary: {status: 'extracting'}}), 'comparing…')
  assert.equal(statusText({executionAuthorized: false, summary: {status: 'failed', error: 'boom'}}), 'failed')
  assert.equal(statusText({executionAuthorized: false, summary: {status: 'trust'}}), 'needs trust')
  assert.equal(changeCount({comparison: {compared: false, rows: 0, changes: {}}}), undefined)
})

test('kind icons, parts and candidate reasons', () => {
  assert.equal(rendererIcon('dependencies'), 'package')
  assert.equal(rendererIcon('database'), 'database')
  assert.equal(rendererIcon('something-new'), 'symbol-structure')
  assert.equal(rendererIcon({bundle: 'renderer/dist'}), 'symbol-misc')
  assert.deepEqual(
    parts({id: 'a', extractor: {command: ['node', 'collect.mjs']}, renderer: {bundle: 'r/dist'}, comparator: 'a.comparator.yaml'}),
    [
      {part: 'extractor', label: 'node collect.mjs', file: 'collect.mjs'},
      {part: 'comparator', label: 'a.comparator.yaml', file: 'a.comparator.yaml'},
      {part: 'renderer', label: 'r/dist'},
    ],
  )
  assert.deepEqual(
    parts({id: 'b', extractor: 'repository-map', renderer: 'graph'}).map(part => part.label),
    ['repository-map', 'default', 'graph'],
  )
  const [candidate] = parseCandidates({
    session: false,
    candidates: [
      {
        id: 'prisma-schema',
        title: 'Prisma schema',
        renderer: 'database',
        requiresTrust: false,
        basis: {pattern: '**/*.prisma', count: 2, examples: ['a.prisma']},
      },
      {title: 'no id'},
    ],
  })
  assert.equal(candidateReason(candidate), '2 files match **/*.prisma')
  assert.equal(candidate.extractor, undefined)
  const [workflow] = parseCandidates({
    candidates: [
      {
        id: 'github-actions-jobs-release',
        extractor: 'github-actions-jobs',
        title: 'GitHub Actions jobs: release.yml',
        definition: {inputs: {workflowPath: '.github/workflows/release.yml'}},
        basis: {pattern: '.github/workflows/*.yml', count: 1, examples: ['.github/workflows/release.yml']},
      },
    ],
  })
  assert.equal(workflow.extractor, 'github-actions-jobs')
  assert.deepEqual(workflow.inputs, {workflowPath: '.github/workflows/release.yml'})
  assert.deepEqual(parseCandidates({}), [])
})

test('projection resources name the tab by the title and carry the folder and ID', () => {
  assert.equal(projectionPath('demo', 'Packages'), '/demo/Packages')
  assert.equal(projectionPath('demo', 'A/B'), '/demo/A∕B')
  const query = projectionQuery('file:///repos/demo', 'packages')
  assert.deepEqual(parseProjectionQuery(query), {folder: 'file:///repos/demo', id: 'packages'})
  assert.equal(parseProjectionQuery('folder=x'), undefined)
  assert.equal(parseProjectionQuery(projectionQuery('file:///x', '../escape')), undefined)
})

test("pairs: the runner's suggestions and bookmarks, labels, swapping and comparing them", () => {
  const pairs = parsePairs({
    default: {
      before: 'f38ab050e19700ff2538444201bc9679dbd81c3d',
      after: 'working-tree',
      label: 'feature/auth since main',
      source: 'merge-base',
    },
    suggestions: [
      {
        before: 'f38ab050e19700ff2538444201bc9679dbd81c3d',
        after: 'working-tree',
        label: 'feature/auth since main',
        source: 'merge-base',
        identical: false,
      },
      {before: 'HEAD~1', after: 'HEAD', label: 'HEAD~1 → HEAD', source: 'parent', identical: false},
      {before: 'v9', after: 'HEAD', label: 'broken', source: 'tag', error: 'unknown revision'},
    ],
    bookmarks: [{id: 'auth', title: 'Auth arrives', projectionId: 'packages', before: 'v1', after: 'v2'}, {title: 'no after'}],
    branches: [
      {name: 'main', commit: 'a'},
      {name: 'feature/auth', commit: 'b', current: true},
    ],
    tags: [{name: 'v1'}],
    head: {branch: 'feature/auth', commit: 'c', dirty: false},
    defaultBranch: 'main',
  })
  assert.deepEqual(pairs.default, {before: 'f38ab050e19700ff2538444201bc9679dbd81c3d', after: 'working-tree'})
  assert.deepEqual(
    pairs.suggestions.map(pair => pair.label),
    ['feature/auth since main', 'HEAD~1 → HEAD'],
  )
  assert.deepEqual(pairs.bookmarks, [
    {before: 'v1', after: 'v2', label: 'Auth arrives', source: 'bookmark', id: 'auth', projection: 'packages'},
  ])
  assert.deepEqual(pairs.head, {branch: 'feature/auth', commit: 'c', dirty: false})
  assert.deepEqual([pairs.branches, pairs.tags], [['main', 'feature/auth'], ['v1']])
  assert.equal(pairLabel(pairs.default), 'f38ab050 → Working tree')
  assert.equal(pairLabel({after: 'HEAD'}), 'HEAD')
  assert.equal(refLabel('main'), 'main')
  assert.deepEqual(swapped({before: 'main', after: 'HEAD'}), {before: 'HEAD', after: 'main'})
  assert.deepEqual(swapped({after: 'HEAD'}), {after: 'HEAD'})
  assert.equal(samePair({before: 'main', after: 'HEAD'}, {before: 'main', after: 'HEAD'}), true)
  assert.equal(samePair({after: 'HEAD'}, {before: 'main', after: 'HEAD'}), false)
  assert.equal(samePair(undefined, {after: 'HEAD'}), false)
  assert.deepEqual(parsePairs({}).suggestions, [])
  // Malformed entries are skipped, not thrown on.
  assert.deepEqual(
    parsePairs({suggestions: [null, 7, ['HEAD'], {before: 'v1', after: 'v2'}]}).suggestions.map(pair => pair.after),
    ['v2'],
  )
})

test('a comparison job counts its changes; the mode toggle moves through the offered modes', () => {
  const job = {
    status: 'completed',
    comparison: {format: 'projections.comparison', comparison: {changes: [{status: 'added'}, {status: 'removed'}, {status: 'added'}]}},
  }
  assert.equal(jobChangeCount(job), 3)
  assert.equal(jobChangeCount({status: 'failed', diagnostics: []}), undefined)
  assert.equal(nextMode('diff', ['diff', 'side-by-side', 'animated']), 'side-by-side')
  assert.equal(nextMode('animated', ['diff', 'side-by-side', 'animated']), 'diff')
  assert.equal(nextMode(undefined, ['swipe']), 'swipe')
  assert.equal(nextMode('diff', []), undefined)
})

test('a definition entry is found at the top level, or where it would go', async () => {
  const {definitionEntry} = await import('../src/projections/definition-entry.ts')
  const text = JSON.stringify(
    {id: 'packages', renderer: {bundle: 'r.html', extractor: 'nested'}, extractor: 'workspace-dependencies', n: 3},
    null,
    2,
  )
  const at = key => {
    const entry = definitionEntry(text, key)
    return entry && 'start' in entry ? text.slice(entry.start, entry.end) : entry
  }
  assert.equal(at('extractor'), '"extractor": "workspace-dependencies"')
  assert.equal(at('renderer'), '"renderer": {\n    "bundle": "r.html",\n    "extractor": "nested"\n  }')
  assert.equal(at('n'), '"n": 3')
  assert.deepEqual(definitionEntry(text, 'comparator'), {insert: text.lastIndexOf('3') + 1, comma: true})
  assert.equal(definitionEntry('not json', 'id'), undefined)
})

test("a built-in part's documentation is a bundled page, opened in VS Code, with its file on GitHub as the explicit link", async () => {
  const {DOCS_BASE, docsOnGitHub, docsPage, partDocs} = await import('../src/projections/docs.ts')
  const index = {
    extractors: {'workspace-dependencies': 'extractors/workspace-dependencies.md'},
    renderers: {graph: 'renderers/graph.md', dependencies: 'renderers/graph.md'},
    comparator: 'comparators/default.md',
    sources: {
      'extractors/workspace-dependencies.md': 'docs/builtins/extractors/workspace-dependencies.md',
      'renderers/graph.md': 'docs/builtins/renderers/graph.md',
      'comparators/default.md': 'docs/builtins/comparators/default.md',
    },
  }
  assert.equal(partDocs(index, 'extractor', 'workspace-dependencies'), 'extractors/workspace-dependencies.md')
  // A renderer by any of its handles.
  assert.equal(partDocs(index, 'renderer', 'dependencies'), 'renderers/graph.md')
  assert.equal(partDocs(index, 'comparator', 'default'), 'comparators/default.md')
  // Ids the bundle doesn't know, files and inherited keys have no page; nor anything without the bundle.
  assert.equal(partDocs(index, 'extractor', 'node tools/extract.mjs'), undefined)
  assert.equal(partDocs(index, 'renderer', 'renderers/custom/dist'), undefined)
  assert.equal(partDocs(index, 'renderer', 'constructor'), undefined)
  assert.equal(partDocs(index, 'comparator', 'tools/c.comparator.yaml'), undefined)
  assert.equal(partDocs(undefined, 'extractor', 'workspace-dependencies'), undefined)
  assert.equal(docsPage('/extractors/workspace-dependencies.md'), 'extractors/workspace-dependencies.md')
  for (const path of ['/', '/../secret.md', '/docs//x.md', '/docs/./x.md', '/a\\b.md']) assert.equal(docsPage(path), undefined, path)
  // The explicit secondary action: the page's file on GitHub.
  assert.equal(
    docsOnGitHub(index, 'renderers/graph.md'),
    'https://github.com/githubnext/projections/blob/main/docs/builtins/renderers/graph.md',
  )
  assert.ok(docsOnGitHub(index, 'renderers/graph.md').startsWith(DOCS_BASE))
  assert.equal(docsOnGitHub(index, 'docs/unknown.md'), undefined)
  assert.equal(docsOnGitHub(undefined, 'renderers/graph.md'), undefined)
})

test('every link the extension contributes stays in VS Code, or goes to an existing file through the same base', async () => {
  const {DOCS_BASE} = await import('../src/projections/docs.ts')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const text = JSON.stringify(manifest)
  for (const link of [...text.matchAll(/https:\/\/github\.com\/githubnext\/projections\/blob\/[^)"\s\\]+/g)].map(match => match[0])) {
    assert.ok(link.startsWith(DOCS_BASE), link)
    assert.ok(existsSync(new URL(`../../../../${link.slice(DOCS_BASE.length).split('#')[0]}`, import.meta.url)), link)
  }
  assert.doesNotMatch(text, /projections\.githubnext\.com/)
  // The welcome's catalog of built-ins is the bundled index, in the Markdown preview.
  const welcome = manifest.contributes.viewsWelcome.map(item => item.contents).join('\n')
  const opened = [...welcome.matchAll(/\(command:projections\.openDocumentation\?([^)]+)\)/g)].map(match =>
    JSON.parse(decodeURIComponent(match[1])),
  )
  assert.deepEqual(opened, [['index.md']])
})

test('projections are listed by the title shown, not the file name', () => {
  // The acme repository's: by ID, ci-jobs would lead and database would follow it.
  const definitions = [
    {id: 'ci-jobs', title: 'CI pipeline'},
    {id: 'platform-dependencies', title: 'Package dependencies (platform first)'},
    {id: 'database', title: 'API database schema'},
    {id: 'dependencies', title: 'Package dependencies'},
    {id: 'step-10', title: 'step 10'},
    {id: 'step-9', title: 'Step 9'},
    {id: 'b', title: 'Same'},
    {id: 'a', title: 'same'},
  ]
  assert.deepEqual(
    byTitle(
      definitions,
      item => item.title,
      item => item.id,
    ).map(item => item.id),
    // Case-insensitive, numbers by value, and the ID breaks a tie.
    ['database', 'ci-jobs', 'dependencies', 'platform-dependencies', 'a', 'b', 'step-9', 'step-10'],
  )
  // A copy: the backend's list keeps its order.
  assert.equal(definitions[0].id, 'ci-jobs')
})
