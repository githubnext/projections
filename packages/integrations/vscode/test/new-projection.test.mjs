// Unit tests of `new-projection-model.ts`: what Projections: New Projection… offers (its quick picks' items, the
// built-in renderers that fit an extractor), the ID checks and the `projections init` arguments it runs; loaded from
// source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {
  agentPrompt,
  customItems,
  definitionDirectory,
  failureMessage,
  freeId,
  identifierPattern,
  idProblem,
  initArguments,
  initFailure,
  languageItems,
  parseExtractors,
  parseRenderers,
  rendererChoices,
  startItems,
  writesExtractor,
} from '../src/new-projection-model.ts'

// As `projections extractor list --json` and `GET /api/renderers` list them (abridged).
const extractors = parseExtractors({
  extractors: [
    {
      id: 'workspace-dependencies',
      title: 'Workspace dependencies',
      description: 'Node packages',
      schema: 'graph/v0',
      renderer: 'dependencies',
      trust: 'none',
    },
    {
      id: 'nestjs-di',
      title: 'NestJS dependency injection',
      description: 'Providers',
      schema: 'architecture/v0',
      renderer: 'dependency-injection',
      trust: 'when-executing-tools',
    },
    {title: 'No ID'},
  ],
})
const renderers = parseRenderers({
  renderers: [
    {
      name: 'graph',
      title: 'Graph',
      handles: ['graph', 'dag', 'architecture', 'dependencies'],
      accepts: [{schema: 'graph/v0'}, {schema: 'architecture/v0'}],
    },
    {
      name: 'file-packing',
      title: 'File packing',
      handles: ['file-packing', 'treemap'],
      accepts: [{schema: 'treemap/v0'}, {schema: 'graph/v0'}],
    },
    {
      name: 'dependency-injection',
      title: 'Dependency injection',
      handles: ['dependency-injection'],
      accepts: [{schema: 'architecture/v0', vocabulary: 'dependency-injection/v0'}],
    },
    {
      name: 'runtime-policy',
      title: 'Runtime security policies',
      handles: ['runtime-policy'],
      accepts: [{schema: 'architecture/v0', vocabulary: 'runtime-policy/v0'}],
    },
    {name: 'database', title: 'Database', handles: ['database'], accepts: [{schema: 'database/v0'}]},
  ],
})

test('the catalogs are read as the CLI and the backend list them', () => {
  assert.deepEqual(
    extractors.map(item => [item.id, item.runsCode]),
    [
      ['workspace-dependencies', false],
      ['nestjs-di', true],
    ],
  )
  assert.throws(() => parseExtractors({}), /no extractors/)
  assert.deepEqual(renderers[0].handles.slice(0, 2), ['graph', 'dag'])
  assert.throws(() => parseRenderers(null), /no renderers/)
})

test('the renderers offered fit the extractor, its default first under the name its template uses', () => {
  const [dependencies, injection] = extractors
  // The default is the graph bundle's `dependencies` preset, not `graph`; other bundles that accept graph/v0 follow.
  assert.deepEqual(rendererChoices(dependencies, renderers), [
    {name: 'dependencies', title: 'Graph', isDefault: true},
    {name: 'file-packing', title: 'File packing', isDefault: false},
  ])
  // A renderer that needs a vocabulary fits only as the default: runtime policies don't present injection.
  assert.deepEqual(
    rendererChoices(injection, renderers).map(choice => choice.name),
    ['dependency-injection', 'graph'],
  )
})

test('the first pick offers suggestions, or exploring when there are none', () => {
  assert.deepEqual(
    startItems(2).map(item => item.start),
    ['suggestion', 'builtin', 'custom', 'agent'],
  )
  assert.match(startItems(2)[0].detail, /^2 built-in projections apply/)
  assert.match(startItems(1)[0].detail, /^One built-in projection applies/)
  assert.deepEqual(
    startItems(0).map(item => item.start),
    ['explore', 'builtin', 'custom', 'agent'],
  )
  // Sentence case, after the codicon.
  for (const item of startItems(0)) assert.match(item.label, /^\$\([a-z-]+\) [A-Z][^A-Z]*$/, item.label)
  assert.deepEqual(
    customItems.map(item => [item.parts, writesExtractor(item.parts)]),
    [
      ['extractor', true],
      ['renderer', false],
      ['extractor-renderer', true],
      ['comparator', false],
    ],
  )
  assert.deepEqual(
    languageItems(true).map(item => item.language ?? null),
    [null, 'node', 'python', 'go'],
  )
  assert.equal(languageItems(false).length, 3)
})

test('projections init gets the flags a person would pass', () => {
  const base = {id: 'deps', title: '', definitionDirectory: '.github/projections'}
  assert.deepEqual(initArguments({...base, extractor: {builtin: 'workspace-dependencies'}}), [
    'init',
    'deps',
    '--extractor',
    'workspace-dependencies',
  ])
  assert.deepEqual(
    initArguments({...base, title: ' Package map ', extractor: {builtin: 'workspace-dependencies'}, renderer: 'file-packing'}),
    ['init', 'deps', '--title', 'Package map', '--extractor', 'workspace-dependencies', '--renderer', 'file-packing'],
  )
  assert.deepEqual(
    initArguments({...base, extractor: {builtin: 'github-actions-jobs', inputs: {workflowPath: 'ci.yml', exclude: ['a/**']}}}),
    ['init', 'deps', '--extractor', 'github-actions-jobs', '--input', 'workflowPath=ci.yml', '--input', 'exclude=["a/**"]'],
  )
  assert.deepEqual(initArguments({...base, extractor: {language: 'python'}, renderer: 'custom'}), [
    'init',
    'deps',
    '--language',
    'python',
    '--renderer',
    'custom',
  ])
  // The repository's toolchain: no --language, as the CLI detects it.
  assert.deepEqual(initArguments({...base, extractor: {language: undefined}}), ['init', 'deps'])
  assert.deepEqual(initArguments({...base, extractor: {builtin: 'nestjs-di'}, comparator: true, definitionDirectory: '.projections'}), [
    'init',
    'deps',
    '--extractor',
    'nestjs-di',
    '--comparator',
    'custom',
    '--definition-directory',
    '.projections',
  ])
  // Where definitions go, as adopting decides.
  assert.equal(definitionDirectory({github: false, dot: false}), '.github/projections')
  assert.equal(definitionDirectory({github: false, dot: true}), '.projections')
  assert.equal(definitionDirectory({github: true, dot: true}), '.github/projections')
})

test('IDs are checked against the definition schema the CLI validates with, and the repository', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../schemas/schemas/definition/v0.json', import.meta.url), 'utf8'))
  const pattern = identifierPattern(schema)
  const taken = id => id === 'packages'
  const problem = id => idProblem(id, {pattern, taken})
  assert.equal(problem('service-map'), undefined)
  assert.equal(problem('v2.api_routes'), undefined)
  assert.match(problem(''), /Enter an ID/)
  assert.match(problem('-leading'), /letters, digits/)
  assert.match(problem('has space'), /letters, digits/)
  assert.match(problem('a'.repeat(101)), /letters, digits/)
  assert.match(problem('environment'), /environment file/)
  assert.match(problem('packages'), /already exists/)
  assert.throws(() => identifierPattern({properties: {}}), /no projection ID pattern/)
  assert.equal(freeId('deps', taken), 'deps')
  assert.equal(freeId('packages', taken), 'packages-2')
})

test('failures are recognized so the error can offer their fix', () => {
  assert.equal(
    failureMessage('warning: x\nError: Projection deps already exists at .github/projections/deps.json\n'),
    'Projection deps already exists at .github/projections/deps.json',
  )
  assert.equal(initFailure('Projection deps already has files, so nothing was written: a. Choose another ID, or edit them'), 'exists')
  assert.equal(initFailure("Choose the extractor's language with --language node, python or go."), 'language')
  assert.equal(initFailure('Unknown extractor x'), 'other')
})

test("the agent's prompt is the one projections init printed, with what the person described", () => {
  const printed = [
    'Created:',
    '  .github/projections/flags.json',
    '',
    'Ask your coding agent:',
    '  Build the "flags" projection in this repository so it shows <what this projection should show>. Start from the scaffold.',
    '',
  ].join('\n')
  assert.equal(
    agentPrompt(printed, 'the feature flags and the services that read them.', 'flags'),
    'Build the "flags" projection in this repository so it shows the feature flags and the services that read them. Start from the scaffold.',
  )
  assert.match(agentPrompt('', 'routes', 'api'), /^Build the "api" projection in this repository so it shows routes\./)
})
