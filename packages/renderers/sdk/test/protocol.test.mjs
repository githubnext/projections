import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptsExtraction,
  annotationTones,
  describeAccepts,
  defaultComparisonModes,
  parseComparisonModes,
  parseHostMessage,
  parseRendererManifest,
  supportedComparisonModes,
  parseRendererMessage,
  parseSummaryItems,
  readRendererFragment,
  rendererFragment,
  rendererLimits,
} from '../dist/protocol.js'
import {RendererConnectionError, connectRenderer} from '../dist/client.js'
import {refusal} from '../dist/react.js'

const channel = 'abcdefghijklmnop0123'
const hostOrigin = 'https://host.example'
const envelope = (message, overrides = {}) => ({projections: 0, channel, ...message, ...overrides})
const environment = {theme: {colorMode: 'dark', tokens: {'color-fg': '#fff'}}, reducedMotion: true, locale: 'en-US'}
const extraction = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}

test('parseRendererMessage accepts every valid renderer message', () => {
  const valid = [
    {type: 'ready', capabilities: {changeHighlighting: 'supported'}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', toggleableRelationships: true, ownTimeline: false}},
    {type: 'rendered', progress: 0},
    {type: 'rendered', progress: 1},
    {type: 'select', id: 'entity:a'},
    {type: 'select', id: null},
    {type: 'height', px: 0},
    {type: 'height', px: 640},
    {type: 'aspect', ratio: 4.5},
    {type: 'aspect', ratio: 0.25},
    {type: 'steps', ends: []},
    {type: 'steps', ends: [0.25, 0.5, 1]},
    {type: 'steps', ends: [0.25, 0.5], slots: 3.5},
    {type: 'open', path: 'src/index.ts'},
    {type: 'open', path: 'src/index.ts', line: 12},
    {type: 'error', message: 'Broken'},
  ]
  for (const message of valid) assert.deepEqual(parseRendererMessage(envelope(message), channel), message, JSON.stringify(message))
})

test('parseRendererMessage rejects foreign envelopes and malformed messages', () => {
  const rendered = {type: 'rendered', progress: 0.5}
  assert.ok(parseRendererMessage(envelope(rendered), channel))
  assert.equal(parseRendererMessage(envelope(rendered), 'zyxwvutsrqponmlk9876'), undefined, 'wrong channel')
  assert.equal(parseRendererMessage(envelope(rendered, {projections: 2}), channel), undefined, 'wrong protocol tag')
  assert.equal(parseRendererMessage({channel, ...rendered}, channel), undefined, 'missing protocol tag')
  for (const value of [null, undefined, 'ready', 1, [], {}]) assert.equal(parseRendererMessage(value, channel), undefined)
  const invalid = [
    {type: 'unknown'},
    {type: 'rendered', progress: 0.5, extra: true},
    {type: 'rendered', progress: -0.01},
    {type: 'rendered', progress: 1.01},
    {type: 'rendered', progress: Number.NaN},
    {type: 'rendered', progress: '0.5'},
    {type: 'select', id: ''},
    {type: 'select', id: 'x'.repeat(rendererLimits.textLength + 1)},
    {type: 'select', id: 3},
    {type: 'select'},
    {type: 'height', px: -1},
    {type: 'aspect', ratio: 0},
    {type: 'aspect', ratio: 1000},
    {type: 'aspect', ratio: '2'},
    {type: 'height', px: Number.POSITIVE_INFINITY},
    {type: 'steps', ends: [0.5, 0.5]},
    {type: 'steps', ends: [0.6, 0.4]},
    {type: 'steps', ends: [0.5, 1.5]},
    {type: 'steps', ends: Array.from({length: rendererLimits.steps + 1}, (_, index) => (index + 1) / (rendererLimits.steps + 1))},
    {type: 'steps', ends: 'all'},
    {type: 'steps', ends: [0.5], slots: -1},
    {type: 'steps', ends: [0.5], slots: '2'},
    {type: 'open', path: ''},
    {type: 'open', path: 'x'.repeat(rendererLimits.textLength + 1)},
    {type: 'open', path: 'a.ts', line: 0},
    {type: 'open', path: 'a.ts', line: 1.5},
    {type: 'error', message: 7},
    {type: 'ready'},
    {type: 'ready', capabilities: {}},
    {type: 'ready', capabilities: {changeHighlighting: 'partial'}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', ownTimeline: 'yes'}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', network: true}},
    {type: 'ready', capabilities: {changeHighlighting: 'none'}, extra: 1},
  ]
  for (const message of invalid)
    assert.equal(parseRendererMessage(envelope(message), channel), undefined, JSON.stringify(message).slice(0, 120))
})

test('parseRendererMessage truncates oversized error text instead of forwarding it', () => {
  const parsed = parseRendererMessage(envelope({type: 'error', message: 'e'.repeat(rendererLimits.textLength * 2)}), channel)
  assert.equal(parsed.message.length, rendererLimits.textLength)
})

test('parseRendererMessage validates hover, anchor and viewport strictly', () => {
  const max = rendererLimits.maxCoordinate
  const valid = [
    {type: 'ready', capabilities: {changeHighlighting: 'supported', hover: true, anchors: true, scrollSync: true}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', hover: false, anchors: false, scrollSync: false}},
    {type: 'hover', id: 'entity:a'},
    {type: 'hover', id: null},
    {type: 'anchor', id: 'entity:a', rect: {x: 10.5, y: -20, width: 120, height: 40}},
    {type: 'anchor', id: 'entity:a', rect: {x: -max, y: max, width: 0, height: 0}},
    {type: 'anchor', id: 'entity:a', rect: null},
    {type: 'viewport', x: 0, y: 0},
    {type: 'viewport', x: 120, y: 48.5, key: 'graph'},
    {type: 'viewport', x: max, y: 0, key: 'div:0>section:2'},
  ]
  for (const message of valid) assert.deepEqual(parseRendererMessage(envelope(message), channel), message, JSON.stringify(message))
  const rect = {x: 0, y: 0, width: 10, height: 10}
  const invalid = [
    {type: 'ready', capabilities: {changeHighlighting: 'none', hover: 'yes'}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', anchors: 1}},
    {type: 'ready', capabilities: {changeHighlighting: 'none', scrollSync: null}},
    {type: 'hover', id: ''},
    {type: 'hover', id: 7},
    {type: 'hover'},
    {type: 'hover', id: 'x'.repeat(rendererLimits.textLength + 1)},
    {type: 'hover', id: 'a', extra: true},
    {type: 'anchor', id: '', rect},
    {type: 'anchor', id: null, rect},
    {type: 'anchor', id: 'x'.repeat(rendererLimits.textLength + 1), rect},
    {type: 'anchor', id: 'a'},
    {type: 'anchor', id: 'a', rect, extra: true},
    {type: 'anchor', id: 'a', rect: {...rect, width: -1}},
    {type: 'anchor', id: 'a', rect: {...rect, height: -0.5}},
    {type: 'anchor', id: 'a', rect: {...rect, depth: 1}},
    {type: 'anchor', id: 'a', rect: {x: 0, y: 0, width: 10}},
    {type: 'anchor', id: 'a', rect: {...rect, x: Number.NaN}},
    {type: 'anchor', id: 'a', rect: {...rect, y: Number.POSITIVE_INFINITY}},
    {type: 'anchor', id: 'a', rect: {...rect, x: max + 1}},
    {type: 'anchor', id: 'a', rect: {...rect, y: -max - 1}},
    {type: 'anchor', id: 'a', rect: {...rect, width: max * 2}},
    {type: 'anchor', id: 'a', rect: {...rect, x: '1'}},
    {type: 'anchor', id: 'a', rect: [0, 0, 10, 10]},
    {type: 'anchor', id: 'a', rect: 'top'},
    {type: 'viewport', x: -1, y: 0},
    {type: 'viewport', x: 0, y: -0.5},
    {type: 'viewport', x: max + 1, y: 0},
    {type: 'viewport', x: Number.NaN, y: 0},
    {type: 'viewport', x: 0},
    {type: 'viewport', x: 0, y: 0, key: ''},
    {type: 'viewport', x: 0, y: 0, key: 3},
    {type: 'viewport', x: 0, y: 0, key: 'a"]'},
    {type: 'viewport', x: 0, y: 0, key: 'x'.repeat(257)},
    {type: 'viewport', x: 0, y: 0, key: null},
    {type: 'viewport', x: 0, y: 0, width: 10},
  ]
  for (const message of invalid)
    assert.equal(parseRendererMessage(envelope(message), channel), undefined, JSON.stringify(message).slice(0, 120))
})

test("parseHostMessage keeps the filter's Changes scope apart from its matches, and older hosts' filters without it", () => {
  const filter = {type: 'filter', query: '', changesOnly: true, ids: ['a']}
  assert.deepEqual(parseHostMessage(envelope(filter), channel), filter)
  assert.deepEqual(parseHostMessage(envelope({...filter, scope: ['a', 'b']}), channel), {...filter, scope: ['a', 'b']})
  assert.deepEqual(parseHostMessage(envelope({...filter, scope: null}), channel), {...filter, scope: null})
  for (const scope of [4, ['a', 4], Array.from({length: rendererLimits.filterIds + 1}, (_, index) => `${index}`)])
    assert.equal(parseHostMessage(envelope({...filter, scope}), channel), undefined, String(scope).slice(0, 20))
})

test('parseHostMessage validates hover and scroll', () => {
  assert.deepEqual(parseHostMessage(envelope({type: 'hover', id: 'entity:a'}), channel), {type: 'hover', id: 'entity:a'})
  assert.deepEqual(parseHostMessage(envelope({type: 'hover', id: null}), channel), {type: 'hover', id: null})
  for (const id of [undefined, 4, {}, ['a']]) assert.equal(parseHostMessage(envelope({type: 'hover', id}), channel), undefined, String(id))
  assert.deepEqual(parseHostMessage(envelope({type: 'scroll', x: 0, y: 12.5}), channel), {type: 'scroll', x: 0, y: 12.5})
  assert.deepEqual(parseHostMessage(envelope({type: 'scroll', x: 40, y: 0, key: 'graph'}), channel), {
    type: 'scroll',
    x: 40,
    y: 0,
    key: 'graph',
  })
  for (const invalid of [
    {x: -1, y: 0},
    {x: 0, y: -1},
    {x: rendererLimits.maxCoordinate + 1, y: 0},
    {x: Number.POSITIVE_INFINITY, y: 0},
    {x: 0},
    {x: 0, y: 0, key: ''},
    {x: 0, y: 0, key: 'a"]'},
    {x: 0, y: 0, key: 7},
    {x: 0, y: 0, behavior: 'smooth'},
  ])
    assert.equal(parseHostMessage(envelope({type: 'scroll', ...invalid}), channel), undefined, JSON.stringify(invalid))
  assert.equal(parseHostMessage(envelope({type: 'hover', id: 'a'}), 'zyxwvutsrqponmlk9876'), undefined)
})

test('parseHostMessage validates structure and envelope', () => {
  const init = {type: 'init', mode: 'extraction', extraction, projection: {id: 'p', title: 'P', renderer: 'graph'}, ...environment}
  assert.deepEqual(parseHostMessage(envelope(init), channel), init, 'init drops the envelope fields')
  const comparison = {
    type: 'init',
    mode: 'comparison',
    before: extraction,
    after: extraction,
    comparison: {protocolVersion: 0, changes: [], steps: []},
    projection: {id: 'p', title: 'P', renderer: 'graph'},
    ...environment,
  }
  assert.equal(parseHostMessage(envelope(comparison), channel).mode, 'comparison')
  assert.equal(parseHostMessage(envelope({...init, mode: 'comparison'}), channel), undefined)
  assert.equal(parseHostMessage(envelope({...init, theme: {colorMode: 'sepia', tokens: {}}}), channel), undefined)
  assert.equal(parseHostMessage(envelope({...init, projection: {id: 'p'}}), channel), undefined)
  // The definition's kind presentation: well-formed entries pass, malformed ones are dropped, never the document.
  const kinds = {
    secret: {color: 'danger', noun: {singular: 'secret key', plural: 'secret keys'}},
    hidden: {color: 'teal'},
    odd: {color: '#ff0000'},
    blank: {noun: {singular: ' ', plural: 'x'}},
  }
  assert.deepEqual(parseHostMessage(envelope({...init, projection: {...init.projection, kinds}}), channel).projection, {
    ...init.projection,
    kinds: {secret: kinds.secret, hidden: kinds.hidden},
  })
  assert.deepEqual(
    parseHostMessage(envelope({...init, projection: {...init.projection, kinds: 'red'}}), channel).projection,
    init.projection,
  )

  // A focus for the opening view: changes or everything, one item, fitted whatever its text size.
  const focused = {...init, focus: {on: 'changes', id: 'service:api', fit: true}}
  assert.deepEqual(parseHostMessage(envelope(focused), channel), focused)
  for (const focus of [{on: 'middle'}, {id: 7}, {fit: 'yes'}, {on: 'all', zoom: 2}, 'changes'])
    assert.equal(parseHostMessage(envelope({...init, focus}), channel), undefined, JSON.stringify(focus))
  assert.deepEqual(parseHostMessage(envelope({type: 'progress', progress: 0.5, highlighting: 1, direction: -1}), channel), {
    type: 'progress',
    progress: 0.5,
    highlighting: 1,
    direction: -1,
  })
  assert.equal(parseHostMessage(envelope({type: 'progress', progress: 0.5, highlighting: 1, direction: 0}), channel), undefined)
  assert.deepEqual(parseHostMessage(envelope({type: 'select', id: null}), channel), {type: 'select', id: null})
  assert.equal(parseHostMessage(envelope({type: 'select', id: 4}), channel), undefined)
  assert.deepEqual(parseHostMessage(envelope({type: 'options', options: {showRelationships: false}}), channel), {
    type: 'options',
    options: {showRelationships: false},
  })
  assert.deepEqual(parseHostMessage(envelope({type: 'viewport', width: 800, height: 600}), channel), {
    type: 'viewport',
    width: 800,
    height: 600,
  })
  assert.deepEqual(parseHostMessage(envelope({type: 'environment', ...environment}), channel), {type: 'environment', ...environment})
  // A held pane of side by side or swipe says which; anything else is refused.
  for (const pane of ['before', 'after'])
    assert.deepEqual(parseHostMessage(envelope({type: 'environment', ...environment, pane}), channel), {
      type: 'environment',
      ...environment,
      pane,
    })
  assert.equal(parseHostMessage(envelope({type: 'environment', ...environment, pane: 'main'}), channel), undefined)
  // How the host sizes the frame, when it says; anything else is refused, in an environment update and in init.
  for (const sizing of ['content', 'fill'])
    assert.deepEqual(parseHostMessage(envelope({type: 'environment', ...environment, sizing}), channel), {
      type: 'environment',
      ...environment,
      sizing,
    })
  assert.equal(parseHostMessage(envelope({type: 'environment', ...environment, sizing: 'auto'}), channel), undefined)
  const sized = {
    type: 'init',
    mode: 'extraction',
    extraction: {protocolVersion: 0, entities: [], relationships: []},
    projection: {id: 'p', title: 'P', renderer: 'graph'},
    ...environment,
  }
  assert.equal(parseHostMessage(envelope({...sized, sizing: 'content'}), channel)?.sizing, 'content')
  assert.equal(parseHostMessage(envelope({...sized, sizing: 'auto'}), channel), undefined)
  assert.equal(
    parseHostMessage(envelope({type: 'progress', progress: 1, highlighting: 0, direction: 1}), 'zyxwvutsrqponmlk9876'),
    undefined,
  )
  assert.equal(parseHostMessage(envelope({type: 'reload'}), channel), undefined)
})

test('renderer fragments round-trip and reject short or missing channels', () => {
  const fragment = rendererFragment(channel, hostOrigin)
  assert.ok(fragment.startsWith('#'))
  assert.deepEqual(readRendererFragment(fragment), {channel, hostOrigin})
  assert.deepEqual(readRendererFragment(fragment.slice(1)), {channel, hostOrigin})
  assert.equal(readRendererFragment(rendererFragment('short', hostOrigin)), undefined)
  // The host's color mode lets the document match the host before init; unknown values are ignored.
  assert.deepEqual(readRendererFragment(rendererFragment(channel, hostOrigin, 'dark')), {channel, hostOrigin, colorMode: 'dark'})
  assert.deepEqual(readRendererFragment(`${fragment}&color=sepia`), {channel, hostOrigin})
  assert.equal(readRendererFragment(rendererFragment('has spaces in the channel', hostOrigin)), undefined)
  assert.equal(readRendererFragment(rendererFragment('x'.repeat(129), hostOrigin)), undefined)
  assert.equal(readRendererFragment(`#channel=${channel}`), undefined)
  assert.equal(readRendererFragment(''), undefined)
})

test('parseRendererManifest validates bundle manifests', () => {
  const manifest = {format: 'projections.renderer', version: 0, name: 'basic', title: 'Basic', handles: ['graph', 'dag']}
  assert.deepEqual(parseRendererManifest(manifest), manifest)
  assert.notEqual(parseRendererManifest(manifest).handles, manifest.handles)
  // 200 characters, though 400 UTF-16 code units: the limit counts code points, as JSON Schema's maxLength does.
  assert.equal(parseRendererManifest({...manifest, title: '🧭'.repeat(200)}).title.length, 400)
  for (const invalid of [
    {...manifest, title: '🧭'.repeat(201)},
    null,
    [],
    {...manifest, format: 'other'},
    {...manifest, version: 1},
    {...manifest, extra: true},
    {...manifest, name: 'Basic'},
    {...manifest, name: '../basic'},
    {...manifest, name: ''},
    {...manifest, title: ' '},
    {...manifest, title: 'x'.repeat(201)},
    {...manifest, handles: 'graph'},
    {...manifest, handles: ['Graph']},
    {...manifest, handles: Array.from({length: 101}, (_, i) => `h${i}`)},
  ])
    assert.throws(() => parseRendererManifest(invalid), Error, JSON.stringify(invalid)?.slice(0, 80))
})

test('manifests declare the extractions they accept: domain schemas, each with an optional vocabulary', () => {
  const manifest = {
    format: 'projections.renderer',
    version: 0,
    name: 'di',
    title: 'DI',
    handles: ['di'],
    accepts: [{schema: 'architecture/v0', vocabulary: 'dependency-injection/v0'}, {schema: 'graph/v0'}],
  }
  assert.deepEqual(parseRendererManifest(manifest), manifest)
  for (const accepts of [
    [],
    'graph/v0',
    [{schema: 'nodes/v0'}],
    [{schema: 'graph/v0', vocabulary: 'unknown/v0'}],
    [{schema: 'graph/v0'}, {schema: 'graph/v0'}],
    [{schema: 'graph/v0', extra: true}],
  ])
    assert.throws(() => parseRendererManifest({...manifest, accepts}), /accepts/, JSON.stringify(accepts))
  const di = manifest.accepts
  assert.equal(acceptsExtraction(undefined, {schema: 'metrics/v0'}), true)
  assert.equal(acceptsExtraction(di, {schema: 'graph/v0', vocabularies: ['infrastructure/v0']}), true)
  assert.equal(acceptsExtraction(di, {schema: 'architecture/v0', vocabularies: ['dependency-injection/v0']}), true)
  assert.equal(acceptsExtraction(di, {schema: 'architecture/v0'}), false)
  assert.equal(acceptsExtraction(di, {schema: 'architecture/v0', vocabularies: ['runtime-policy/v0']}), false)
  assert.equal(describeAccepts(di), '`architecture/v0` with `dependency-injection/v0` or `graph/v0`')
  assert.equal(describeAccepts([{schema: 'database/v0'}]), '`database/v0`')
})

test('init fills missing data, as the engine normalizes it; a renderer refuses an extraction it does not accept', () => {
  const raw = {
    ...extraction,
    entities: [{id: 'a', kind: 'k', label: 'a'}],
    relationships: [{id: 'r', kind: 'k', from: 'a', to: 'a', data: {x: 1}}],
  }
  const init = {type: 'init', mode: 'extraction', extraction: raw, projection: {id: 'p', title: 'P', renderer: 'graph'}, ...environment}
  const parsed = parseHostMessage(envelope(init), channel)
  assert.deepEqual(parsed.extraction.entities[0].data, {})
  assert.deepEqual(parsed.extraction.relationships[0].data, {x: 1})
  assert.equal(raw.entities[0].data, undefined, 'the message is not mutated')
  const compared = parseHostMessage(
    envelope({...init, mode: 'comparison', before: raw, after: raw, comparison: {protocolVersion: 0, changes: [], steps: []}}),
    channel,
  )
  assert.deepEqual([compared.before.entities[0].data, compared.after.entities[0].data], [{}, {}])
  assert.equal(refusal(undefined, parsed), undefined)
  assert.equal(refusal([{schema: 'graph/v0'}], parsed), undefined)
  assert.equal(refusal([{schema: 'database/v0'}], parsed), 'This renderer presents `database/v0`; this extraction is `graph/v0`.')
  const vocabulary = {...compared, after: {...compared.after, schema: 'architecture/v0', vocabularies: ['infrastructure/v0']}}
  assert.equal(
    refusal([{schema: 'graph/v0'}], vocabulary),
    'This renderer presents `graph/v0`; this extraction is `architecture/v0` with `infrastructure/v0`.',
  )
})

test('comparison modes: declarations, manifests and diff-mode init', () => {
  assert.deepEqual(parseComparisonModes(['diff', 'side-by-side']), ['diff', 'side-by-side'])
  for (const invalid of [[], ['diff', 'diff'], ['morph'], 'diff', null, ['animated', 'side-by-side', 'swipe', 'diff', 'animated']]) {
    assert.equal(parseComparisonModes(invalid), undefined, JSON.stringify(invalid))
  }
  assert.deepEqual(supportedComparisonModes(undefined), defaultComparisonModes)
  assert.deepEqual(supportedComparisonModes({comparisonModes: ['diff']}), ['diff'])
  const ready = capabilities => parseRendererMessage(envelope({type: 'ready', capabilities}), channel)
  assert.deepEqual(ready({changeHighlighting: 'supported', comparisonModes: ['diff', 'side-by-side']}), {
    type: 'ready',
    capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff', 'side-by-side']},
  })
  for (const comparisonModes of [[], ['diff', 'diff'], ['morph'], 'diff'])
    assert.equal(ready({changeHighlighting: 'supported', comparisonModes}), undefined)
  assert.deepEqual(ready({changeHighlighting: 'supported', pace: {stepMs: 1800}}), {
    type: 'ready',
    capabilities: {changeHighlighting: 'supported', pace: {stepMs: 1800}},
  })
  for (const pace of [
    {stepMs: 299},
    {stepMs: 5001},
    {stepMs: 1800.5},
    {stepMs: '1800'},
    {stepMs: 1800, easing: 'slow'},
    {},
    [1800],
    1800,
    null,
  ]) {
    assert.equal(ready({changeHighlighting: 'supported', pace}), undefined, JSON.stringify(pace))
  }
  const manifest = {format: 'projections.renderer', version: 0, name: 'plan', title: 'Plan', handles: [], comparisonModes: ['diff']}
  assert.deepEqual(parseRendererManifest(manifest), manifest)
  assert.throws(() => parseRendererManifest({...manifest, comparisonModes: ['diff', 'diff']}))
  const init = {
    type: 'init',
    ...environment,
    projection: {id: 'p', title: 'P', renderer: 'plan'},
    mode: 'comparison',
    before: extraction,
    after: extraction,
    comparison: {protocolVersion: 0, changes: [], steps: []},
  }
  assert.equal(parseHostMessage(envelope({...init, comparisonMode: 'diff'}), channel)?.comparisonMode, 'diff')
  assert.equal(parseHostMessage(envelope(init), channel)?.comparisonMode, undefined)
  assert.equal(parseHostMessage(envelope({...init, comparisonMode: 'morph'}), channel), undefined)
})

function fakeWindow(hash = rendererFragment(channel, hostOrigin)) {
  const posted = []
  const listeners = new Set()
  const parent = {postMessage: (data, target) => posted.push({data, target})}
  const timers = new Map()
  let nextTimer = 1
  const view = {
    location: {hash},
    parent,
    setTimeout: callback => {
      const id = nextTimer++
      timers.set(id, callback)
      return id
    },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') listeners.delete(listener)
    },
  }
  const deliver = (data, {source = parent, origin = hostOrigin} = {}) => {
    for (const listener of listeners) listener({data, source, origin})
  }
  const expire = () => {
    for (const [id, callback] of [...timers]) {
      timers.delete(id)
      callback()
    }
  }
  return {view, parent, posted, listeners, deliver, expire}
}

test('connectRenderer posts ready to the host origin with the channel envelope', () => {
  const fake = fakeWindow()
  const capabilities = {changeHighlighting: 'supported', ownTimeline: false}
  const client = connectRenderer({}, {capabilities, window: fake.view})
  assert.equal(client.channel, channel)
  assert.deepEqual(fake.posted, [{data: {projections: 0, channel, type: 'ready', capabilities}, target: hostOrigin}])
  assert.deepEqual(parseRendererMessage(fake.posted[0].data, channel), {type: 'ready', capabilities})
  client.rendered(1.5)
  client.select('a')
  client.height(rendererLimits.maxHeight + 100)
  client.steps([0.5, 1])
  client.open('src/a.ts', 3)
  client.error('Broken')
  assert.deepEqual(
    fake.posted.slice(1).map(({data}) => parseRendererMessage(data, channel)),
    [
      {type: 'rendered', progress: 1},
      {type: 'select', id: 'a'},
      {type: 'height', px: rendererLimits.maxHeight},
      {type: 'steps', ends: [0.5, 1]},
      {type: 'open', path: 'src/a.ts', line: 3},
      {type: 'error', message: 'Broken'},
    ],
  )
  assert.ok(fake.posted.every(({target}) => target === hostOrigin))
  client.dispose()
  assert.equal(fake.listeners.size, 0)
  client.select('b')
  assert.equal(fake.posted.length, 7, 'nothing is posted after dispose')
})

test('observeHeight requests the height at once, before any resize is observed, then each new one', () => {
  const fake = fakeWindow()
  const observers = []
  const Observer = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
    disconnect() {}
  }
  try {
    const client = connectRenderer({}, {capabilities: {changeHighlighting: 'none'}, window: fake.view})
    let height = 320.4
    client.observeHeight({getBoundingClientRect: () => ({height})})
    const heights = () => fake.posted.map(({data}) => parseRendererMessage(data, channel)).filter(message => message.type === 'height')
    assert.deepEqual(heights(), [{type: 'height', px: 321}])
    observers[0].callback([])
    assert.equal(heights().length, 1, 'the same height is not requested again')
    height = 500
    observers[0].callback([])
    assert.deepEqual(heights(), [
      {type: 'height', px: 321},
      {type: 'height', px: 500},
    ])
  } finally {
    globalThis.ResizeObserver = Observer
  }
})

test('connectRenderer dispatches valid host messages and ignores foreign ones', () => {
  const fake = fakeWindow()
  const received = []
  const record = type => payload => received.push([type, payload])
  connectRenderer(
    {
      init: record('init'),
      progress: record('progress'),
      select: record('select'),
      options: record('options'),
      viewport: record('viewport'),
      environment: record('environment'),
    },
    {capabilities: {changeHighlighting: 'none'}, window: fake.view},
  )
  const init = {type: 'init', mode: 'extraction', extraction, projection: {id: 'p', title: 'P', renderer: 'graph'}, ...environment}
  fake.deliver(envelope(init), {source: {}})
  fake.deliver(envelope(init), {origin: 'https://evil.example'})
  fake.deliver({...envelope(init), channel: 'zyxwvutsrqponmlk9876'})
  fake.deliver(envelope({type: 'progress', progress: 'half', highlighting: 0, direction: 1}))
  assert.deepEqual(received, [])
  fake.deliver(envelope(init))
  fake.deliver(envelope({type: 'progress', progress: 0.25, highlighting: 0.5, direction: -1}))
  fake.deliver(envelope({type: 'select', id: 'a'}))
  fake.deliver(envelope({type: 'options', options: {showRelationships: true}}))
  fake.deliver(envelope({type: 'viewport', width: 300, height: 200}))
  fake.deliver(envelope({type: 'environment', ...environment}))
  const {type: _type, ...initPayload} = init
  assert.deepEqual(received, [
    ['init', initPayload],
    ['progress', {progress: 0.25, highlighting: 0.5, direction: -1}],
    ['select', {id: 'a'}],
    ['options', {showRelationships: true}],
    ['viewport', {width: 300, height: 200}],
    ['environment', environment],
  ])
})

test('a client that connects again in the same document is replayed the host state', async () => {
  const fake = fakeWindow()
  const record = received => ({
    init: payload => received.push(['init', payload.projection.id]),
    progress: payload => received.push(['progress', payload.progress]),
    select: payload => received.push(['select', payload.id]),
    options: payload => received.push(['options', payload]),
  })
  const first = []
  const client = connectRenderer(record(first), {capabilities: {changeHighlighting: 'none'}, window: fake.view})
  const init = id =>
    envelope({type: 'init', mode: 'extraction', extraction, projection: {id, title: 'P', renderer: 'graph'}, ...environment})
  fake.deliver(init('old'))
  fake.deliver(envelope({type: 'progress', progress: 0.25, highlighting: 0.5, direction: 1}))
  fake.deliver(init('p'))
  fake.deliver(envelope({type: 'options', options: {dense: true}}))
  fake.deliver(envelope({type: 'progress', progress: 0.5, highlighting: 0.5, direction: 1}))
  fake.deliver(envelope({type: 'select', id: 'a'}))
  fake.deliver(envelope({type: 'action', id: 'zoom-in'}))
  client.dispose()

  // A hot update remounts the renderer: it gets the latest state, in protocol order.
  const second = []
  connectRenderer(record(second), {capabilities: {changeHighlighting: 'none'}, window: fake.view})
  assert.deepEqual(second, [], 'replayed after connecting')
  await Promise.resolve()
  assert.deepEqual(second, [
    ['init', 'p'],
    ['options', {dense: true}],
    ['select', 'a'],
    ['progress', 0.5],
  ])
  assert.equal(fake.posted.filter(({data}) => data.type === 'ready').length, 2)

  // Another channel (a new frame) starts fresh.
  const other = fakeWindow(rendererFragment('zyxwvutsrqponmlk9876', hostOrigin))
  const third = []
  connectRenderer(record(third), {capabilities: {changeHighlighting: 'none'}, window: other.view})
  await Promise.resolve()
  assert.deepEqual(third, [])
})

test('connectRenderer dispatches hover and scroll to handlers and subscribers', () => {
  const fake = fakeWindow()
  const received = []
  const seen = []
  const client = connectRenderer(
    {
      hover: payload => received.push(['hover', payload]),
      scroll: payload => received.push(['scroll', payload]),
    },
    {capabilities: {changeHighlighting: 'none', hover: true, anchors: true, scrollSync: true}, window: fake.view},
  )
  const stop = client.subscribe(message => seen.push(message))
  fake.deliver(envelope({type: 'hover', id: 'a'}), {source: {}})
  fake.deliver(envelope({type: 'scroll', x: -5, y: 0}))
  fake.deliver(envelope({type: 'hover', id: 'a'}))
  fake.deliver(envelope({type: 'scroll', x: 10, y: 20}))
  fake.deliver(envelope({type: 'scroll', x: 0, y: 3, key: 'graph'}))
  fake.deliver(envelope({type: 'hover', id: null}))
  assert.deepEqual(received, [
    ['hover', {id: 'a'}],
    ['scroll', {x: 10, y: 20}],
    ['scroll', {x: 0, y: 3, key: 'graph'}],
    ['hover', {id: null}],
  ])
  assert.deepEqual(seen, [
    {type: 'hover', id: 'a'},
    {type: 'scroll', x: 10, y: 20},
    {type: 'scroll', x: 0, y: 3, key: 'graph'},
    {type: 'hover', id: null},
  ])
  stop()
  fake.deliver(envelope({type: 'hover', id: 'b'}))
  assert.equal(seen.length, 4, 'an unsubscribed listener sees nothing more')
  assert.equal(received.length, 5)
})

test('connectRenderer posts valid hover, anchor and viewport messages', () => {
  const fake = fakeWindow()
  const capabilities = {changeHighlighting: 'none', hover: true, anchors: true, scrollSync: true}
  const client = connectRenderer({}, {capabilities, window: fake.view})
  client.hover('a')
  client.hover(null)
  client.anchor('a', {x: 10.123, y: -4.567, width: 50.001, height: -3})
  client.anchor('a', null)
  client.viewport({x: 12.345, y: -2})
  client.viewport({x: 0, y: 8, key: 'graph'})
  assert.deepEqual(
    fake.posted.map(({data}) => parseRendererMessage(data, channel)),
    [
      {type: 'ready', capabilities},
      {type: 'hover', id: 'a'},
      {type: 'hover', id: null},
      {type: 'anchor', id: 'a', rect: {x: 10.12, y: -4.57, width: 50, height: 0}},
      {type: 'anchor', id: 'a', rect: null},
      {type: 'viewport', x: 12.35, y: 0},
      {type: 'viewport', x: 0, y: 8, key: 'graph'},
    ],
  )
})

test('connectRenderer targets any origin only when the host origin is opaque', () => {
  const fake = fakeWindow(rendererFragment(channel, 'null'))
  const received = []
  connectRenderer({select: payload => received.push(payload)}, {capabilities: {changeHighlighting: 'none'}, window: fake.view})
  assert.equal(fake.posted[0].target, '*')
  fake.deliver(envelope({type: 'select', id: null}), {origin: 'null'})
  fake.deliver(envelope({type: 'select', id: 'x'}), {source: {}, origin: 'null'})
  assert.deepEqual(received, [{id: null}])
})

test('connectRenderer requires a host frame and a channel fragment', () => {
  assert.throws(
    () => connectRenderer({}, {capabilities: {changeHighlighting: 'none'}, window: fakeWindow('').view}),
    RendererConnectionError,
  )
  assert.throws(
    () => connectRenderer({}, {capabilities: {changeHighlighting: 'none'}, window: fakeWindow('#channel=short&origin=x').view}),
    RendererConnectionError,
  )
  const top = fakeWindow()
  top.view.parent = top.view
  assert.throws(() => connectRenderer({}, {capabilities: {changeHighlighting: 'none'}, window: top.view}), RendererConnectionError)
  assert.equal(top.posted.length, 0)
})

test('select carries an optional RFC 6901 property path in both directions', () => {
  for (const path of ['', '/data', '/data/owner', '/a~0b/c~1d', '/items/0', '/ unicode é']) {
    assert.deepEqual(parseRendererMessage(envelope({type: 'select', id: 'a', path}), channel), {type: 'select', id: 'a', path}, path)
    assert.deepEqual(parseHostMessage(envelope({type: 'select', id: 'a', path}), channel), {type: 'select', id: 'a', path}, path)
  }
  for (const path of ['data', '/a~2', '/a~', '~1', 3, null, `/${'x'.repeat(rendererLimits.textLength)}`]) {
    assert.equal(parseRendererMessage(envelope({type: 'select', id: 'a', path}), channel), undefined, String(path))
    assert.equal(parseHostMessage(envelope({type: 'select', id: 'a', path}), channel), undefined, String(path))
  }
  assert.equal(parseRendererMessage(envelope({type: 'select', id: null, path: '/a'}), channel), undefined, 'a path needs an item')
  assert.equal(parseHostMessage(envelope({type: 'select', id: null, path: '/a'}), channel), undefined, 'a path needs an item')
  assert.equal(parseRendererMessage(envelope({type: 'select', id: 'a', path: '/a', property: 'a'}), channel), undefined)
})

test('annotation reports and annotations marks validate strictly', () => {
  assert.deepEqual(parseRendererMessage(envelope({type: 'annotation', id: 'entity:a'}), channel), {type: 'annotation', id: 'entity:a'})
  for (const invalid of [
    {type: 'annotation'},
    {type: 'annotation', id: ''},
    {type: 'annotation', id: null},
    {type: 'annotation', id: 4},
    {type: 'annotation', id: 'x'.repeat(rendererLimits.textLength + 1)},
    {type: 'annotation', id: 'a', count: 2},
  ])
    assert.equal(parseRendererMessage(envelope(invalid), channel), undefined, JSON.stringify(invalid).slice(0, 80))
  const valid = [
    [],
    [{id: 'a'}],
    [
      {id: 'a', count: 0},
      {id: 'b', count: rendererLimits.annotationCount, label: '2 comments', tone: 'attention'},
      {id: 'c', tone: 'done'},
      {id: 'd', tone: 'neutral'},
      {id: 'e', tone: 'subtle'},
    ],
    [{id: 'a', label: 'x'.repeat(rendererLimits.annotationLabel)}],
    Array.from({length: rendererLimits.annotations}, (_, index) => ({id: `i${index}`})),
  ]
  for (const items of valid)
    assert.deepEqual(parseHostMessage(envelope({type: 'annotations', items}), channel), {type: 'annotations', items})
  const invalid = [
    undefined,
    null,
    {},
    'a',
    [null],
    ['a'],
    [{}],
    [{id: ''}],
    [{id: 3}],
    [{id: 'x'.repeat(rendererLimits.textLength + 1)}],
    [{id: 'a', count: -1}],
    [{id: 'a', count: 1.5}],
    [{id: 'a', count: rendererLimits.annotationCount + 1}],
    [{id: 'a', count: '2'}],
    [{id: 'a', count: Number.NaN}],
    [{id: 'a', label: 'x'.repeat(rendererLimits.annotationLabel + 1)}],
    [{id: 'a', label: 2}],
    [{id: 'a', tone: 'danger'}],
    [{id: 'a', tone: null}],
    [{id: 'a', author: 'mona'}],
    [{id: 'a', body: 'Looks wrong'}],
    Array.from({length: rendererLimits.annotations + 1}, (_, index) => ({id: `i${index}`})),
  ]
  for (const items of invalid) {
    assert.equal(parseHostMessage(envelope({type: 'annotations', items}), channel), undefined, JSON.stringify(items)?.slice(0, 80))
  }
  const parsed = parseHostMessage(envelope({type: 'annotations', items: [{id: 'a', count: 1}]}), channel)
  assert.deepEqual(Object.keys(parsed.items[0]), ['id', 'count'], 'absent optional fields stay absent')
})

test('ready accepts the annotations and properties capabilities as booleans', () => {
  const capabilities = {changeHighlighting: 'none', annotations: true, properties: false}
  assert.deepEqual(parseRendererMessage(envelope({type: 'ready', capabilities}), channel), {type: 'ready', capabilities})
  for (const flags of [{annotations: 'yes'}, {properties: 1}, {comments: true}]) {
    assert.equal(parseRendererMessage(envelope({type: 'ready', capabilities: {changeHighlighting: 'none', ...flags}}), channel), undefined)
  }
})

test('connectRenderer dispatches annotations and selection paths, and posts select paths and annotation', () => {
  const fake = fakeWindow()
  const received = []
  const seen = []
  const client = connectRenderer(
    {
      select: payload => received.push(['select', payload]),
      annotations: items => received.push(['annotations', items]),
    },
    {capabilities: {changeHighlighting: 'none', annotations: true, properties: true}, window: fake.view},
  )
  client.subscribe(message => seen.push(message.type))
  fake.deliver(envelope({type: 'select', id: 'a', path: '/data/owner'}))
  fake.deliver(envelope({type: 'select', id: 'a'}))
  fake.deliver(envelope({type: 'select', id: 'a', path: 'owner'}))
  fake.deliver(envelope({type: 'annotations', items: [{id: 'a', count: 2, tone: 'attention'}, {id: 'b'}]}))
  fake.deliver(envelope({type: 'annotations', items: [{id: 'a', tone: 'urgent'}]}))
  fake.deliver(envelope({type: 'annotations', items: []}))
  assert.deepEqual(received, [
    ['select', {id: 'a', path: '/data/owner'}],
    ['select', {id: 'a'}],
    ['annotations', [{id: 'a', count: 2, tone: 'attention'}, {id: 'b'}]],
    ['annotations', []],
  ])
  assert.equal('path' in received[1][1], false, 'a select without a path has no path key')
  assert.deepEqual(seen, ['select', 'select', 'annotations', 'annotations'])

  client.select('a', '/data/owner')
  client.select('a', '')
  client.select('a')
  client.select(null, '/ignored')
  client.annotation('a')
  client.annotation('')
  assert.throws(() => client.select('a', 'owner'), RendererConnectionError)
  assert.throws(() => client.select('a', '/a~2'), RendererConnectionError)
  const messages = fake.posted.slice(1).map(({data}) => parseRendererMessage(data, channel))
  assert.deepEqual(messages, [
    {type: 'select', id: 'a', path: '/data/owner'},
    {type: 'select', id: 'a', path: ''},
    {type: 'select', id: 'a'},
    {type: 'select', id: null},
    {type: 'annotation', id: 'a'},
  ])
  assert.equal('path' in fake.posted[3].data, false, 'select without a path posts no path key')
})

test('annotation badge tones never use change colors, and every tone is styled', async () => {
  const {readFile} = await import('node:fs/promises')
  const source = await readFile(new URL('../dist/interactions/badge-style.js', import.meta.url), 'utf8')
  const style = source.slice(
    source.indexOf('const badgeStyle'),
    source.indexOf('`', source.indexOf('`', source.indexOf('const badgeStyle')) + 1),
  )
  assert.ok(style.includes('--projections-color-accent-emphasis'))
  assert.doesNotMatch(style, /--projections-color-(added|removed|modified|moved)/)
  for (const tone of annotationTones.filter(tone => tone !== 'neutral')) assert.match(style, new RegExp(`data-tone="${tone}"`))
})

test('legends are validated strictly: theme tokens or plain CSS colors, bounded labels and counts', () => {
  const legend = items => envelope({type: 'legend', items})
  const valid = [
    [],
    [
      {label: 'Added', token: 'color-added', shape: 'square'},
      {label: 'Calls', color: '#0969da', shape: 'line'},
      {label: 'Inferred', token: 'color-fg-muted', shape: 'dashed'},
      {label: 'Alias', token: 'color-fg-muted', shape: 'dotted'},
    ],
    [
      {label: 'Rgb', color: 'rgb(9 105 218 / 50%)'},
      {label: 'Hsl', color: 'hsl(212, 92%, 45%)'},
      {label: 'x'.repeat(rendererLimits.legendLabel), token: 'chart-1', shape: 'circle'},
    ],
    Array.from({length: rendererLimits.legendItems}, (_, index) => ({label: `Item ${index}`, token: 'chart-2'})),
    [{label: 'Service'}, {label: 'Queue'}],
  ]
  for (const items of valid) assert.deepEqual(parseRendererMessage(legend(items), channel), {type: 'legend', items})
  assert.deepEqual(parseRendererMessage(envelope({type: 'legend', title: 'Changes', items: []}), channel), {
    type: 'legend',
    title: 'Changes',
    items: [],
  })
  for (const items of [
    [{label: 'Both', token: 'color-added', color: '#fff'}],
    [{label: 'Shape without a swatch', shape: 'circle'}],
    [{label: '', token: 'color-added'}],
    [{label: 'x'.repeat(rendererLimits.legendLabel + 1), token: 'color-added'}],
    [{label: 'Unknown token', token: 'color-nope'}],
    [{label: 'Url', color: 'url(https://example.com/x.png)'}],
    [{label: 'Var', color: 'var(--x)'}],
    [{label: 'Named', color: 'red; background: url(x)'}],
    [{label: 'Shape', token: 'color-added', shape: 'star'}],
    [{label: 'Extra', token: 'color-added', extra: true}],
    Array.from({length: rendererLimits.legendItems + 1}, (_, index) => ({label: `Item ${index}`, token: 'chart-2'})),
  ])
    assert.equal(parseRendererMessage(legend(items), channel), undefined, JSON.stringify(items).slice(0, 80))
  assert.equal(parseRendererMessage(envelope({type: 'legend', title: '', items: []}), channel), undefined)
  assert.equal(parseRendererMessage(envelope({type: 'legend', items: [], extra: 1}), channel), undefined)
})

test('summaries are validated strictly: distinct kinds, bounded nouns and non-negative integer counts', () => {
  const summary = items => envelope({type: 'summary', items})
  const noun = {singular: 'workspace', plural: 'workspaces'}
  const valid = [
    [],
    [{kind: 'package', noun, count: 12}],
    [
      {kind: 'package', noun, count: 12, added: 1, removed: 1},
      {kind: 'dependencies', noun: {singular: 'dependency', plural: 'dependencies'}, count: 0, added: 0, modified: 2},
    ],
    [{kind: 'k'.repeat(rendererLimits.summaryKind), noun: {singular: 'x'.repeat(rendererLimits.summaryNoun), plural: 'y'}, count: 1}],
    Array.from({length: rendererLimits.summaryItems}, (_, index) => ({kind: `kind-${index}`, noun, count: index})),
    [
      {collection: 'entities', kind: 'index', noun, count: 1},
      {collection: 'relationships', kind: 'index', noun, count: 2},
    ],
  ]
  for (const items of valid) assert.deepEqual(parseRendererMessage(summary(items), channel), {type: 'summary', items})
  for (const items of [
    undefined,
    {},
    [{kind: '', noun, count: 1}],
    [
      {kind: 'package', noun, count: 1},
      {kind: 'package', noun, count: 2},
    ],
    [{kind: 'package', noun: {singular: 'workspace'}, count: 1}],
    [{kind: 'package', noun: {singular: 'workspace', plural: ''}, count: 1}],
    [{kind: 'package', noun: {singular: ' ', plural: 'workspaces'}, count: 1}],
    [{kind: 'package', noun: {...noun, extra: 'x'}, count: 1}],
    [{kind: 'package', noun: {singular: 'x'.repeat(rendererLimits.summaryNoun + 1), plural: 'y'}, count: 1}],
    [{kind: 'k'.repeat(rendererLimits.summaryKind + 1), noun, count: 1}],
    [{kind: 'package', noun, count: -1}],
    [{kind: 'package', noun, count: 1.5}],
    [{kind: 'package', noun, count: '1'}],
    [{kind: 'package', noun}],
    [{kind: 'package', noun, count: 1, added: -1}],
    [{kind: 'package', noun, count: 1, renamed: 1}],
    [{collection: 'items', kind: 'package', noun, count: 1}],
    [
      {kind: 'index', noun, count: 1},
      {collection: 'relationships', kind: 'index', noun, count: 1},
    ],
    [
      {collection: 'entities', kind: 'index', noun, count: 1},
      {collection: 'entities', kind: 'index', noun, count: 1},
    ],
    Array.from({length: rendererLimits.summaryItems + 1}, (_, index) => ({kind: `kind-${index}`, noun, count: index})),
  ])
    assert.equal(parseRendererMessage(summary(items), channel), undefined, JSON.stringify(items)?.slice(0, 80))
  assert.equal(parseRendererMessage(envelope({type: 'summary', items: [], extra: 1}), channel), undefined)
  assert.deepEqual(parseSummaryItems([{kind: 'package', noun, count: 3, removed: 0}]), [{kind: 'package', noun, count: 3, removed: 0}])
})

test('summary items are counts or facts; an item of an unknown type is dropped, the rest kept', () => {
  const summary = items => parseRendererMessage(envelope({type: 'summary', items}), channel)
  const noun = {singular: 'breaking change', plural: 'breaking changes'}
  const count = {type: 'count', kind: 'route', noun: {singular: 'route', plural: 'routes'}, count: 4, added: 1}
  const fact = {type: 'fact', id: 'breaking', icon: 'breaking', count: 2, noun, tone: 'removed', ids: ['route:a', 'route:b']}
  assert.deepEqual(summary([count, fact, {type: 'fact', id: 'plain', count: 0, noun}]), {
    type: 'summary',
    items: [count, fact, {type: 'fact', id: 'plain', count: 0, noun}],
  })
  // Later types are additive: an unknown one is dropped, not the message.
  assert.deepEqual(summary([{type: 'chart', id: 'x', values: [1, 2]}, count]), {type: 'summary', items: [count]})
  for (const items of [
    [{...fact, id: ''}],
    [fact, {...fact}],
    [{...fact, icon: 'Shield'}],
    [{...fact, icon: 'x'.repeat(65)}],
    [{...fact, tone: 'loud'}],
    [{...fact, count: -1}],
    [{...fact, noun: {singular: 'x'}}],
    [{...fact, ids: ['']}],
    [{...fact, ids: 'route:a'}],
    [{...fact, ids: Array.from({length: rendererLimits.summaryFactIds + 1}, (_, index) => `id-${index}`)}],
    [{...fact, kind: 'route'}],
    [{...count, id: 'x'}],
    [{...count, type: 7}],
  ])
    assert.equal(summary(items), undefined, JSON.stringify(items).slice(0, 80))
  assert.ok(summary([{...fact, ids: Array.from({length: rendererLimits.summaryFactIds}, (_, index) => `id-${index}`)}]))
})

test('a summary fact may carry its changes and a description', () => {
  const summary = items => parseRendererMessage(envelope({type: 'summary', items}), channel)
  const noun = {singular: 'line of code', plural: 'lines of code'}
  const measure = {type: 'fact', id: 'total', count: 39882, noun, added: 2056, description: 'Code lines, every file'}
  const subset = {
    type: 'fact',
    id: 'values',
    count: 6,
    noun: {singular: 'enum value', plural: 'enum values'},
    added: 2,
    removed: 1,
    modified: 0,
  }
  assert.deepEqual(summary([measure, subset]), {type: 'summary', items: [measure, subset]})
  for (const items of [
    [{...measure, added: -1}],
    [{...measure, removed: 1.5}],
    [{...measure, modified: '1'}],
    [{...measure, description: ''}],
    [{...measure, description: ' '}],
    [{...measure, description: 'x'.repeat(rendererLimits.summaryDescription + 1)}],
    [{...measure, description: 7}],
    [{...measure, was: 37826}],
  ])
    assert.equal(summary(items), undefined, JSON.stringify(items).slice(0, 80))
  assert.ok(summary([{...measure, description: 'x'.repeat(rendererLimits.summaryDescription)}]))
  // A count item has no description.
  assert.equal(summary([{kind: 'route', noun, count: 1, description: 'Routes'}]), undefined)
})

test('a control value from the renderer validates strictly', () => {
  for (const value of ['lines:descending', true, 0.5])
    assert.deepEqual(parseRendererMessage(envelope({type: 'control', id: 'sort', value}), channel), {type: 'control', id: 'sort', value})
  for (const message of [
    {id: 'sort', value: ''},
    {id: 'sort', value: 'x'.repeat(65)},
    {id: 'sort', value: Number.NaN},
    {id: 'sort', value: null},
    {id: 'has space', value: true},
    {id: 'sort'},
    {id: 'sort', value: true, extra: 1},
  ])
    assert.equal(parseRendererMessage(envelope({type: 'control', ...message}), channel), undefined, JSON.stringify(message))
})

test('document-request and document validate strictly', () => {
  assert.deepEqual(parseRendererMessage(envelope({type: 'document-request', renderer: 'graph'}), channel), {
    type: 'document-request',
    renderer: 'graph',
  })
  for (const renderer of ['', 'Graph', '../graph', 'https://example.com/index.html', 'a'.repeat(65), 7])
    assert.equal(parseRendererMessage(envelope({type: 'document-request', renderer}), channel), undefined, String(renderer))
  assert.equal(parseRendererMessage(envelope({type: 'document-request', renderer: 'graph', url: 'x'}), channel), undefined)
  assert.deepEqual(parseHostMessage(envelope({type: 'document', renderer: 'graph', html: '<p>'}), channel), {
    type: 'document',
    renderer: 'graph',
    html: '<p>',
  })
  assert.deepEqual(parseHostMessage(envelope({type: 'document', renderer: 'graph', error: 'No'}), channel), {
    type: 'document',
    renderer: 'graph',
    error: 'No',
  })
  for (const message of [
    {type: 'document', renderer: 'graph'},
    {type: 'document', renderer: 'graph', html: '<p>', error: 'No'},
    {type: 'document', renderer: 'Graph', html: '<p>'},
    {type: 'document', renderer: 'graph', html: 1},
    {type: 'document', renderer: 'graph', html: '<p>', url: 'x'},
  ])
    assert.equal(parseHostMessage(envelope(message), channel), undefined, JSON.stringify(message))
})

test('requestDocument asks the host once per name and settles with its answer', async () => {
  const fake = fakeWindow()
  const client = connectRenderer({}, {capabilities: {changeHighlighting: 'none'}, window: fake.view})
  const graph = client.requestDocument('graph')
  assert.equal(client.requestDocument('graph'), graph, 'one request per name')
  const custom = client.requestDocument('minimal')
  const requests = fake.posted.slice(1).map(({data}) => parseRendererMessage(data, channel))
  assert.deepEqual(requests, [
    {type: 'document-request', renderer: 'graph'},
    {type: 'document-request', renderer: 'minimal'},
  ])
  fake.deliver(envelope({type: 'document', renderer: 'graph', html: '<!doctype html>'}), {source: {}})
  fake.deliver(envelope({type: 'document', renderer: 'graph', html: '<!doctype html>'}))
  fake.deliver(envelope({type: 'document', renderer: 'minimal', error: 'minimal is not a built-in renderer'}))
  assert.equal(await graph, '<!doctype html>')
  await assert.rejects(custom, {name: 'RendererConnectionError', message: 'minimal is not a built-in renderer'})
  await assert.rejects(client.requestDocument('../graph'), /Invalid renderer name/)
  // A refused name may be asked again; one the host never answers times out.
  const again = client.requestDocument('minimal')
  assert.equal(fake.posted.length, 4)
  fake.expire()
  await assert.rejects(again, /did not supply the minimal renderer/)
  client.dispose()
})
