import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel} from '@githubnext/projections-renderer-kit'
import {parseControls} from '@githubnext/projections-renderer-sdk/protocol'
import {languageColor, languageNamed} from '@githubnext/projections-renderer-sdk/languages'
import {
  badgeValues,
  cardFacts,
  colorValue,
  drawnKinds,
  factControls,
  factFields,
  fieldPointer,
  cardChanges,
  fieldWords,
  pointerField,
  unknownIconFacts,
  withRelationships,
} from '../node_modules/.cache/test/facts.js'

const engine = createNativeEngine()
const entity = (id, kind, data) => ({id, kind, label: id, ...(data ? {data} : {})})
const link = (from, to, kind) => ({id: `${kind}:${from}:${to}`, kind, from, to})
const extraction = (entities, relationships) => ({protocolVersion: 0, schema: 'architecture/v0', entities, relationships})
const before = extraction(
  [
    entity('ns', 'module'),
    entity('open', 'method', {capabilities: ['network'], scope: 'public', secret: false, meta: {a: 1}}),
    entity('read', 'stream', {capabilities: ['network', 'jsonValue'], scope: 'internal', secret: true}),
    entity('auth', 'scope'),
  ],
  [link('ns', 'open', 'contains'), link('ns', 'read', 'contains'), link('open', 'auth', 'requires'), link('read', 'open', 'calls')],
)
const after = extraction(
  [
    ...before.entities.slice(0, 2),
    entity('read', 'stream', {capabilities: ['jsonValue'], scope: 'internal', secret: true, sessionScoped: true}),
    before.entities[3],
  ],
  before.relationships,
)
const model = comparisonModel(before, after, await engine.compare(before, after))

test('pointers name top-level data fields, escaped as RFC 6901 says', () => {
  assert.equal(fieldPointer('capabilities'), '/data/capabilities')
  assert.equal(fieldPointer('a/b~c'), '/data/a~1b~0c')
  assert.equal(pointerField('/data/a~1b~0c'), 'a/b~c')
  assert.equal(pointerField('/data/a/b'), undefined)
  assert.equal(pointerField('kind'), undefined)
})

test("a document's fields are offered as badges (scalars and lists) and colors (scalars only)", () => {
  assert.deepEqual(factFields(model), {
    badges: ['capabilities', 'scope', 'secret', 'sessionScoped'],
    colors: ['scope', 'secret', 'sessionScoped'],
    numbers: [],
    texts: ['scope'],
    icons: [],
  })
  const controls = factControls(factFields(model), drawnKinds(model, 'architecture'))
  // Hosts accept them as declared, so a definition's rendererOptions can preset them.
  assert.deepEqual(
    parseControls(controls)?.map(control => control.id),
    ['subtitle', 'icon', 'badges', 'labels', 'highlights', 'tags', 'colorBy', 'relationships', 'relationshipColors'],
  )
  assert.deepEqual(
    controls.find(control => control.id === 'colorBy').choices.map(choice => choice.value),
    ['none', 'kind', '/data/scope', '/data/secret', '/data/sessionScoped'],
  )
  // Architecture draws containment as boundaries; the graph draws it as arrows.
  assert.deepEqual(drawnKinds(model, 'architecture'), ['calls', 'requires'])
  assert.deepEqual(drawnKinds(model, 'graph'), ['calls', 'contains', 'requires'])
  assert.deepEqual(
    factControls({badges: [], colors: [], numbers: [], texts: [], icons: []}, ['calls']).map(control => control.id),
    ['icon', 'colorBy'],
    'one relationship kind needs no choice of kinds or colors',
  )
})

test('badges and colors read lists, strings, numbers and booleans', () => {
  const read = after.entities[2]
  assert.deepEqual(badgeValues(read, 'capabilities'), ['jsonValue'])
  assert.deepEqual(badgeValues(read, 'sessionScoped'), ['sessionScoped'])
  assert.deepEqual(badgeValues(after.entities[1], 'secret'), [])
  assert.deepEqual(badgeValues(read, 'missing'), [])
  assert.equal(colorValue(read, 'kind'), 'stream')
  assert.equal(colorValue(read, '/data/scope'), 'internal')
  assert.equal(colorValue(after.entities[1], '/data/secret'), 'not secret')
  assert.equal(colorValue(after.entities[3], '/data/scope'), undefined)
})

test('the legend lists card colors then relationship kinds, every one its own color', () => {
  const facts = cardFacts(model, {badges: '/data/capabilities', colorBy: '/data/scope', kinds: ['calls', 'requires'], colorMode: 'light'})
  assert.equal(facts.legend.title, 'scope')
  assert.deepEqual(
    facts.legend.items.map(item => [item.label, item.shape ?? 'square']),
    [
      ['internal', 'square'],
      ['public', 'square'],
      ['calls', 'line'],
      ['requires', 'line'],
    ],
  )
  const tokens = facts.legend.items.map(item => item.token ?? item.color)
  assert.equal(new Set(tokens).size, tokens.length)
  assert.deepEqual(facts.badges(after.entities[2]), ['jsonValue'])
  assert.equal(facts.accent(after.entities[2]).label, 'scope: internal')
  assert.equal(facts.accent(after.entities[3]), undefined, 'a card without the field has no accent')
  assert.match(facts.relationshipColor(before.relationships[2]), /^var\(--projections-chart-\d+\)$/u)
  // Nothing chosen: no badges, accents or legend.
  const none = cardFacts(model, {badges: 'none', colorBy: 'none', kinds: [], colorMode: 'light'})
  assert.deepEqual([none.badges, none.accent, none.relationshipColor, none.legend], [undefined, undefined, undefined, undefined])
  assert.equal(
    cardFacts(model, {badges: 'none', colorBy: 'none', kinds: ['calls', 'requires'], colorMode: 'light'}).legend.title,
    'Relationships',
  )
})

const sized = extraction(
  [
    entity('engine', 'crate', {code: 23000, language: 'Rust', description: 'The shared engine', traits: ['property tests'], runs: ['cli']}),
    entity('host', 'package', {code: 900, language: 'TypeScript', description: 'The browser host'}),
    entity('helper', 'package', {language: 'Go'}),
  ],
  [link('host', 'engine', 'depends-on'), link('host', 'engine', 'loads'), link('engine', 'helper', 'spawns')],
)
const one = comparisonModel(sized, sized, await engine.compare(sized, sized))

test('a numeric field sizes cards and a text field is their subtitle', () => {
  assert.deepEqual(factFields(one), {
    badges: ['code', 'description', 'language', 'runs', 'traits'],
    colors: ['code', 'description', 'language'],
    numbers: ['code'],
    texts: ['description', 'language'],
    icons: [],
  })
  const facts = cardFacts(one, {
    badges: 'none',
    colorBy: 'none',
    subtitle: '/data/description',
    sizeBy: '/data/code',
    kinds: [],
    colorMode: 'light',
    locale: 'en',
  })
  const [engineCard, host, helper] = sized.entities
  assert.equal(facts.subtitle(engineCard), 'The shared engine')
  assert.equal(facts.subtitle(helper), undefined)
  // The number reads compact at the right of the kind line, and the legend says what it is.
  assert.deepEqual([facts.detail(engineCard), facts.detail(host), facts.detail(helper)], ['23K', '900', undefined])
  assert.deepEqual(facts.legend, {title: 'Cards', items: [{label: 'Number on each card: code'}]})
})

test('labels are worded badges, before the code badges', () => {
  const facts = cardFacts(one, {badges: '/data/runs', labels: '/data/traits', colorBy: 'none', kinds: [], colorMode: 'light'})
  assert.deepEqual(facts.badges(sized.entities[0]), [{text: 'property tests', prose: true}, 'cli'])
  assert.deepEqual(facts.badges(sized.entities[1]), [])
})

test('a field naming programming languages colors cards in their GitHub colors', () => {
  const facts = cardFacts(one, {badges: 'none', colorBy: '/data/language', kinds: [], colorMode: 'light'})
  // Linguist's colors (made legible on the theme), not the categorical palette's tokens.
  const languages = ['Go', 'Rust', 'TypeScript']
  assert.deepEqual(
    facts.legend.items.map(item => [item.label, item.color]),
    languages.map(name => [name, languageColor(languageNamed(name), 'light')]),
  )
  assert.equal(facts.accent(sized.entities[0]).paint, languageColor(languageNamed('Rust'), 'light'))
  // Any other field keeps the palette.
  assert.match(
    cardFacts(model, {badges: 'none', colorBy: '/data/scope', kinds: [], colorMode: 'light'}).accent(after.entities[2]).paint,
    /chart/u,
  )
})

test('the Relationships control draws one kind, and containment always', () => {
  assert.deepEqual(drawnKinds(one, 'architecture'), ['depends-on', 'loads', 'spawns'])
  const ids = shown => withRelationships(one, shown).relationships.map(row => row.id)
  assert.deepEqual(ids('depends-on'), ['depends-on:host:engine'])
  assert.equal(withRelationships(one, 'all'), one)
  assert.deepEqual(
    withRelationships(model, 'calls')
      .relationships.map(row => (row.after ?? row.before).kind)
      .sort(),
    ['calls', 'contains', 'contains'],
  )
  const controls = factControls(factFields(one), drawnKinds(one, 'architecture'))
  assert.deepEqual(
    controls.find(control => control.id === 'relationships').choices.map(choice => choice.value),
    ['all', 'depends-on', 'loads', 'spawns'],
  )
})

test('highlights come first and tags last, each in its own tone', () => {
  const facts = cardFacts(one, {
    badges: 'none',
    highlights: '/data/traits',
    tags: '/data/runs',
    labels: '/data/language',
    colorBy: 'none',
    kinds: [],
    colorMode: 'light',
  })
  assert.deepEqual(facts.badges(sized.entities[0]), [
    {text: 'property tests', tone: 'highlight'},
    {text: 'Rust', prose: true},
    {text: 'cli', tone: 'quiet'},
  ])
})

test("a modified card names the data changes it doesn't mark itself in plain words, and counts bulky ones", async () => {
  const unit = data => ({id: 'u', kind: 'crate', label: 'u', data})
  const objects = {capabilityModules: {fs: ['src/a']}, more: {x: 1}, other: {y: 1}}
  const unitBefore = extraction([unit({tokens: 4000, runs: ['cli'], testTokens: 12000, ...objects})], [])
  const changed = {capabilityModules: {fs: ['src/b']}, more: {x: 2}, other: {y: 2}}
  const unitAfter = extraction([unit({tokens: 5000, runs: ['cli', 'wasm'], testTokens: 14000, ...changed})], [])
  const row = comparisonModel(unitBefore, unitAfter, await engine.compare(unitBefore, unitAfter)).entities[0]
  // The size and the tags are drawn on the card (`4K → 5K`, a gained tag); a number reads compactly; of three objects,
  // one is named and the others counted.
  assert.deepEqual(cardChanges(row, ['tokens', 'runs'], 'en'), [
    {key: 'test tokens', before: '12K', after: '14K', prose: true},
    {key: 'capability modules changed', before: '', after: '', summary: true},
    {key: '2 more fields changed', before: '', after: '', summary: true},
  ])
  // One or two objects are named.
  const twoObjects = extraction([unit({tokens: 5000, runs: ['cli'], testTokens: 12000, ...objects, ...{more: {x: 2}, other: {y: 2}}})], [])
  const named = comparisonModel(twoObjects, unitAfter, await engine.compare(twoObjects, unitAfter)).entities[0]
  assert.deepEqual(cardChanges(named, ['tokens', 'runs', 'testTokens'], 'en'), [
    {key: 'capability modules changed', before: '', after: '', summary: true},
  ])
  assert.equal(fieldWords('provedFunctions'), 'proved functions')
  assert.equal(fieldWords('max_retry-count'), 'max retry count')
  assert.equal(fieldWords('HTTPStatus'), 'http status')
})

test("a field naming icons picks each card's icon; an unknown name draws none and the summary warns of it", async () => {
  const named = extraction(
    [
      entity('cli', 'module', {icon: 'terminal', description: 'The command line'}),
      entity('engine', 'module', {icon: 'not-an-icon'}),
      entity('host', 'module', {icon: '<svg onload=alert(1)>'}),
      entity('docs', 'module'),
    ],
    [],
  )
  const icons = comparisonModel(named, named, await engine.compare(named, named))
  // Only a text field with a known icon name is offered for icons.
  assert.deepEqual(factFields(icons).icons, ['icon'])
  const control = factControls(factFields(icons), []).find(item => item.id === 'icon')
  assert.deepEqual(
    control.choices.map(choice => choice.value),
    ['none', '/data/icon'],
  )
  // Revisions that predate their icons still offer the conventional field, so a definition's preset of it stands.
  const predating = factControls(factFields(model), []).find(item => item.id === 'icon')
  assert.deepEqual(
    predating.choices.map(choice => choice.value),
    ['none', '/data/icon'],
  )
  const facts = cardFacts(icons, {badges: 'none', colorBy: 'none', icon: '/data/icon', kinds: [], colorMode: 'light'})
  assert.deepEqual(
    named.entities.map(item => facts.icon(item)),
    ['terminal', undefined, undefined, undefined],
  )
  assert.equal(cardFacts(icons, {badges: 'none', colorBy: 'none', kinds: [], colorMode: 'light'}).icon, undefined)
  const [warning, ...rest] = unknownIconFacts(icons, '/data/icon')
  assert.equal(rest.length, 0)
  assert.deepEqual(
    {...warning, description: undefined},
    {
      type: 'fact',
      id: 'unknown-icons',
      icon: 'warning',
      count: 2,
      noun: {singular: 'unknown icon', plural: 'unknown icons'},
      ids: ['engine', 'host'],
      description: undefined,
    },
  )
  assert.match(warning.description, /"<svg onload=alert\(1\)>", "not-an-icon"/u)
  assert.deepEqual(unknownIconFacts(icons, 'none'), [])
  assert.deepEqual(unknownIconFacts(model, '/data/scope'), [
    {
      type: 'fact',
      id: 'unknown-icons',
      icon: 'warning',
      count: 2,
      noun: {singular: 'unknown icon', plural: 'unknown icons'},
      ids: ['open', 'read'],
      description: 'No icon is drawn for "internal", "public": scope must name one of the graph renderer\'s card icons.',
    },
  ])
})
