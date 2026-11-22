import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {allChecks, checkTitles, runChecks} from '../dist/src/index.js'
import {checkFailures, connectInspector, samples, scenarioKeys} from '../dist/playwright/index.js'
import {StageRecord, bounded} from '../dist/playwright/bounded.js'

const noop = () => undefined

test('scenario keys use the directory name for scenarios.json and the file name otherwise', () => {
  const root = mkdtempSync(join(tmpdir(), 'projections-testing-'))
  mkdirSync(join(root, 'graph'))
  const document = JSON.stringify({format: 'projections.scenarios', version: 0, scenarios: [{id: 'one'}, {id: 'two'}]})
  writeFileSync(join(root, 'graph', 'scenarios.json'), document)
  writeFileSync(join(root, 'edge-cases.scenarios.json'), document)
  assert.deepEqual(scenarioKeys(join(root, 'graph')), ['graph/one', 'graph/two'])
  assert.deepEqual(scenarioKeys(join(root, 'graph', 'scenarios.json')), ['graph/one', 'graph/two'])
  assert.deepEqual(scenarioKeys(join(root, 'edge-cases.scenarios.json')), ['edge-cases/one', 'edge-cases/two'])
})

test('connectInspector builds page URLs on the workbench origin', () => {
  const inspector = connectInspector('http://127.0.0.1:4400/?view=stage')
  assert.equal(inspector.page(), 'http://127.0.0.1:4400/')
  assert.equal(inspector.page({view: 'stage'}), 'http://127.0.0.1:4400/?view=stage')
  assert.equal(inspector.page({scenario: 'graph/one'}), 'http://127.0.0.1:4400/?scenario=graph%2Fone')
})

test('check failures are flattened with their titles; samples round trip', () => {
  assert.equal(allChecks.length, 27)
  const failures = checkFailures([
    {id: 'legend', title: checkTitles.legend, status: 'fail', details: ['two legends'], durationMs: 1},
    {id: 'selection', title: checkTitles.selection, status: 'pass', details: [], durationMs: 1},
    {id: 'step-holds', title: checkTitles['step-holds'], status: 'skip', details: ['no holds'], durationMs: 1},
  ])
  assert.deepEqual(failures, ['Legend drawn by the host: two legends'])
  assert.deepEqual(samples(2, {roundTrip: true}), [0, 0.5, 1, 0.5, 0])
})

/** A stage that records how it is driven, for a renderer declaring `modes`, drawing `drawn` entities in diff mode. */
function fakeDriver(
  modes,
  {clipped = [], drawn = [], capabilities = {}, opening = () => ({viewport: {width: 1280, height: 650}, canvases: []})} = {},
) {
  const loads = []
  let mode
  const sample = (id, paint) => ({key: id, id, box: [0, 0, 10, 10], opacity: 1, paint, text: id, parts: [], categories: {}})
  return {
    loads,
    driver: {
      async load(subject, options) {
        loads.push({subject, ...options})
        mode = options.comparisonMode
        return {
          status: 'ready',
          capabilities: {changeHighlighting: 'supported', ...(modes ? {comparisonModes: modes} : {}), ...capabilities},
          progress: 1,
          highlighting: 0,
          direction: 1,
          selection: null,
          selections: [],
          steps: [],
          controls: [],
          opened: [],
          errors: [],
          rejected: [],
        }
      },
      // Seeking keeps the loaded subject and mode.
      async seek(progress) {
        const {subject, ...options} = loads.at(-1)
        return this.load(subject, {...options, progress})
      },
      select: noop,
      hover: noop,
      state: () => ({selections: []}),
      async measure(call) {
        const unchanged = loads.at(-1).subject.comparison?.changes.length === 0
        if (call === 'samples') {
          return mode === 'diff' ? [sample('a', unchanged ? 'plain' : 'tinted'), sample('b', 'plain')] : [sample('b', 'plain')]
        }
        if (call === 'clipping') return clipped
        if (call === 'entities') return drawn
        if (call === 'overflow') return {scrollWidth: 300, clientWidth: 300, offenders: []}
        if (call === 'opening') return opening(loads.at(-1))
        return []
      },
      async compare() {
        return {protocolVersion: 0, changes: [], steps: []}
      },
      sleep: () => Promise.resolve(),
    },
  }
}
const extraction = ids => ({
  protocolVersion: 0,
  schema: 'graph/v0',
  entities: ids.map(id => ({id, kind: 'item', label: id})),
  relationships: [],
})
const subject = {
  mode: 'comparison',
  before: extraction(['b']),
  after: extraction(['a', 'b']),
  comparison: {
    protocolVersion: 0,
    changes: [{id: 'a', collection: 'entities', before: [], after: ['a'], status: 'added', correspondence: 'exact'}],
    steps: [{changes: ['a']}],
  },
}

test('stable-layout compares two diffs once each frame has the height its renderer asked for', async () => {
  // A new frame paints first at 320 px, then the host applies the renderer's 1217 px; a fitted drawing re-centres.
  let height = 1217
  let pending = 0
  const sample = () => ({
    key: 'a',
    id: 'a',
    box: [0, height === 320 ? 12 : 28.5, 10, 10],
    opacity: 1,
    paint: 'plain',
    text: 'a',
    parts: [],
    categories: {},
  })
  const driver = {
    async load(_subject, options) {
      // Only the first load starts a frame; the second reuses it at its height.
      height = options.highlighting === 1 ? 320 : 1217
      pending = options.highlighting === 1 ? 3 : 0
      return {
        status: 'ready',
        capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']},
        progress: 1,
        highlighting: 0,
        direction: 1,
        selection: null,
        selections: [],
        steps: [],
        controls: [],
        opened: [],
        errors: [],
        rejected: [],
      }
    },
    seek: () => Promise.resolve(),
    select: noop,
    hover: noop,
    state: () => ({selections: [], height: 1217}),
    async measure(call) {
      if (call === 'settle' && pending && !--pending) height = 1217
      if (call === 'samples') return [sample()]
      if (call === 'opening') return {viewport: {width: 1280, height}, canvases: []}
      return []
    },
    async compare() {
      return {protocolVersion: 0, changes: [], steps: []}
    },
    sleep: () => Promise.resolve(),
  }
  const [result] = await runChecks(driver, subject, {checks: ['stable-layout']})
  assert.equal(result.status, 'pass', result.details.join('\n'))
})

test('checks run per declared comparison mode', async () => {
  const status = results => Object.fromEntries(results.map(result => [result.id, result.status]))
  const diffOnly = fakeDriver(['diff'])
  const only = await runChecks(diffOnly.driver, subject, {
    checks: ['neutral-endpoints', 'step-holds', 'highlight-scope', 'diff-changes', 'diff-neutral', 'diff-clipping', 'legend'],
  })
  assert.deepEqual(status(only), {
    'neutral-endpoints': 'skip',
    'step-holds': 'skip',
    'highlight-scope': 'skip',
    'diff-changes': 'pass',
    'diff-neutral': 'pass',
    'diff-clipping': 'pass',
    legend: 'pass',
  })
  // The default mode (side by side when supported, else the first in canonical order) presents the other checks.
  assert.equal(diffOnly.loads.at(-1).comparisonMode, 'diff')

  const defaults = fakeDriver(undefined)
  const all = status(await runChecks(defaults.driver, subject, {checks: ['diff-changes', 'diff-clipping', 'legend']}))
  assert.deepEqual(all, {'diff-changes': 'skip', 'diff-clipping': 'skip', legend: 'pass'})
  assert.equal(defaults.loads.at(-1).comparisonMode, undefined)

  const clipped = await runChecks(
    fakeDriver(['diff', 'side-by-side'], {clipped: ['div.row shows 10×0px of its 10×20px content']}).driver,
    subject,
    {checks: ['diff-clipping']},
  )
  assert.equal(clipped[0].status, 'fail')
  assert.match(clipped[0].details[0], /10×0px/u)
})

test('a zoomable renderer opens fitted in a fixed frame, or at the 8 px text floor on its start; its smallest text is reported', async () => {
  const canvas = (load, overrides = {}) => ({
    element: 'div.graph-scroll',
    zoom: 1,
    entities: 3,
    area: [0, 0, load.width ?? 1280, load.height],
    content: [16, 16, 300, 200],
    outside: [],
    start: {element: 'g.graph-node[data-entity-id="a"]', corner: [16, 16], inView: 'top-left'},
    cut: [],
    changes: {count: 0, inView: 0, whole: 0},
    scrolls: false,
    smallestText: load.width ? 4.2 : 9.8,
    ...overrides,
  })
  const run = async (modes, opening) => {
    const fake = fakeDriver(modes, {
      opening: load => ({viewport: {width: load.width ?? 1280, height: load.height}, canvases: opening(load)}),
    })
    const [result] = await runChecks(fake.driver, subject, {checks: ['opens-fitted']})
    return {result, loads: fake.loads.slice(1)}
  }
  // Document-style renderers have no zoomable canvas.
  assert.equal((await run(['diff'], () => [])).result.status, 'skip')
  // Fitted everywhere: passes, and says how small the text is.
  const fitted = await run(['diff', 'side-by-side', 'animated'], load => [canvas(load)])
  assert.equal(fitted.result.status, 'pass')
  assert.ok(
    fitted.result.details.some(detail =>
      /full width \(1280×650\), the diff: fitted, 3 entities in view, smallest text 9\.8px/u.test(detail),
    ),
    fitted.result.details.join('\n'),
  )
  assert.ok(fitted.result.details.some(detail => /390px \(390×700\), side by side at After \(progress 1\): fitted.*4\.2px/u.test(detail)))
  // Each presentation in a frame of fixed size: the diff, then the first progress mode, at full and phone width.
  assert.deepEqual(
    fitted.loads.map(load => [load.comparisonMode, load.width, load.height]),
    [
      ['diff', undefined, 650],
      ['side-by-side', undefined, 650],
      ['side-by-side', undefined, 650],
      ['diff', 390, 700],
      ['side-by-side', 390, 700],
      ['side-by-side', 390, 700],
    ],
  )
  // At the floor: zoomed until the smallest text is 8 px, its start in view, the rest scrolled to. Passes and says so.
  const outside = ['g.graph-node[data-entity-id="c"] at [1400, 10, 1520, 90]']
  const floored = await run(['diff'], load => [canvas(load, {zoom: 2, scrolls: true, smallestText: 8, outside})])
  assert.equal(floored.result.status, 'pass', floored.result.details.join('\n'))
  assert.ok(
    floored.result.details.some(detail => /at the 8px floor \(zoom 2, fitted text would be 4px\), opens on its top-left/u.test(detail)),
  )
  // Opened zoomed further than the floor (the former 11 px floor), below it, where the fit was readable, or away
  // from its start: fails, naming the fix.
  const zoomed = await run(['diff'], load => [canvas(load, {zoom: 1.4, scrolls: true, smallestText: 11})])
  assert.equal(zoomed.result.status, 'fail')
  assert.match(zoomed.result.details[0], /opens zoomed \(1\.4\) further than the 8px floor \(smallest text 11px\)/u)
  const small = await run(['diff'], load => [canvas(load, {zoom: 1.4, scrolls: true, smallestText: 7, outside})])
  assert.match(small.result.details[0], /with smallest text 7px, below the 8px floor, and not everything fits/u)
  const readable = await run(['diff'], load => [canvas(load, {zoom: 1.2, scrolls: true, smallestText: 10})])
  assert.match(readable.result.details[0], /although fitted its smallest text would be 8\.33px, at least the 8px floor; open fitted/u)
  const away = await run(['diff'], load => [
    canvas(load, {zoom: 2, scrolls: true, smallestText: 8, outside, start: {element: 'g.graph-node', corner: [-200, 300], inView: false}}),
  ])
  assert.match(
    away.result.details[0],
    /opens at the 8px floor scrolled away from the start of its content: g\.graph-node at \[-200, 300\]/u,
  )
  // Its top row's middle in view, but a card cut off at the left edge (a row too wide to centre): fails.
  const leftCut = await run(['diff'], load => [
    canvas(load, {
      zoom: 2,
      scrolls: true,
      smallestText: 8,
      outside,
      start: {element: 'g.graph-node', corner: [-40, 16], inView: 'top-centre'},
      cut: ['g.graph-node[data-entity-id="vscode"] at [-40, 16, 120, 96]'],
    }),
  ])
  assert.equal(leftCut.result.status, 'fail')
  assert.match(
    leftCut.result.details[0],
    /with an entity cut off at the left or top edge of the visible canvas \[0, 0, 1280, 650\], for example g\.graph-node\[data-entity-id="vscode"\]/u,
  )
  // A diff that doesn't fit may open on its changes instead of its start: zoomed past the floor only to fit them all.
  const start = {element: 'g.graph-node', corner: [-200, 300], inView: false}
  const changes = (count, inView, whole, smallestText) =>
    run(['diff'], load => [canvas(load, {zoom: 2, scrolls: true, smallestText, outside, start, changes: {count, inView, whole}})])
  const onChanges = await changes(3, 3, 3, 9.6)
  assert.equal(onChanges.result.status, 'pass', onChanges.result.details.join('\n'))
  assert.ok(onChanges.result.details.some(detail => /on its changes \(zoom 2\), 3 of 3 wholly in view/u.test(detail)))
  assert.equal((await changes(3, 1, 1, 8)).result.status, 'pass')
  assert.match((await changes(3, 1, 1, 12)).result.details[0], /further than the 8px floor \(smallest text 12px\) with 2 of its 3 changes/u)
  assert.match((await changes(3, 0, 0, 8)).result.details[0], /with none of its 3 changes in view/u)
  // Below the floor but fitted, everything in view: passes (the phone frame above, at 4.2 px).
  const cut = await run(['diff'], load =>
    load.width ? [canvas(load, {outside: ['g.graph-node[data-entity-id="a"] at [400, 10, 520, 90]']})] : [canvas(load)],
  )
  assert.equal(cut.result.status, 'fail')
  assert.deepEqual(cut.result.details.length, 1)
  assert.match(
    cut.result.details[0],
    /^At 390px \(390×700\), the diff, 1 of 3 entities are outside the visible canvas \[0, 0, 390, 700\], for example g\.graph-node/u,
  )
})

test('the relationships check expects a drawn relationship between drawn entities, unless the renderer opts out', async () => {
  const linked = {
    mode: 'extraction',
    extraction: {...extraction(['a', 'b', 'c']), relationships: [{id: 'calls:a->b', kind: 'calls', from: 'a', to: 'b'}]},
  }
  const run = async options => (await runChecks(fakeDriver(undefined, options).driver, linked, {checks: ['relationships']}))[0]
  const missing = await run({drawn: ['a', 'b', 'c']})
  assert.equal(missing.status, 'fail')
  assert.match(missing.details[0], /calls:a->b/u)
  assert.match(missing.details[0], /drawsRelationships: false/u)
  assert.equal((await run({drawn: ['a', 'b', 'c', 'calls:a->b']})).status, 'pass')
  // Nothing to expect when an endpoint isn't drawn, or when the renderer declares it draws none.
  assert.equal((await run({drawn: ['a', 'c']})).status, 'skip')
  assert.equal((await run({drawn: ['a', 'b'], capabilities: {drawsRelationships: false}})).status, 'skip')
})

test('the relationships check expects only the relationships the presentation draws', async () => {
  const linked = {
    mode: 'extraction',
    extraction: {
      ...extraction(['a', 'b', 'c']),
      relationships: [
        {id: 'bundles:a->b', kind: 'bundles', from: 'a', to: 'b'},
        {id: 'depends-on:a->c', kind: 'depends-on', from: 'a', to: 'c'},
      ],
    },
  }
  const run = async (drawn, rendererOptions) =>
    (await runChecks(fakeDriver(undefined, {drawn}).driver, linked, {checks: ['relationships'], rendererOptions}))[0]
  // Drawing only depends-on, the renderer passes without the bundles relationship it was asked not to draw.
  assert.equal((await run(['a', 'b', 'c', 'depends-on:a->c'], {relationships: 'depends-on'})).status, 'pass')
  // A kind it draws between drawn entities must still be marked.
  const missing = await run(['a', 'b', 'c', 'bundles:a->b'], {relationships: 'depends-on'})
  assert.equal(missing.status, 'fail')
  assert.match(missing.details[0], /depends-on:a->c/u)
  // No relationship of that kind between drawn entities: nothing to expect.
  assert.equal((await run(['a', 'b'], {relationships: 'depends-on'})).status, 'skip')
  // `all`, or no option, expects every kind; relationships turned off expect none.
  assert.equal((await run(['a', 'b', 'c'], {relationships: 'all'})).status, 'fail')
  assert.equal((await run(['a', 'b', 'c'], {showRelationships: false})).status, 'skip')
})

/** A stage whose renderer document measures as `elements(colorMode)`, with a small theme. */
function styledDriver(elements, exemptions = []) {
  let colorMode = 'light'
  const tokens = mode => ({
    colors:
      mode === 'light'
        ? {'color-fg': '#111111', 'color-bg': '#ffffff', 'color-added': '#00aa00'}
        : {'color-fg': '#eeeeee', 'color-bg': '#000000', 'color-added': '#33ff33'},
    fontSizes: [12, 13, 14],
    fontFamilies: ['sans'],
    fontWeights: [400, 600],
    spaces: [4, 8],
    radii: [6],
    borderWidths: [1, 2],
  })
  return {
    async load(_subject, options) {
      colorMode = options.colorMode ?? 'light'
      return {status: 'ready', capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
    },
    async measure(call) {
      if (call === 'styles') return {tokens: tokens(colorMode), elements: elements(colorMode), exemptions}
      return undefined
    },
    sleep: () => Promise.resolve(),
  }
}
const element = (index, properties) => ({
  element: `span.part${index}`,
  index,
  colors: {},
  spacing: {},
  radii: {},
  borders: {},
  category: false,
  ...properties,
})

test('the styling checks hold colors, type and spacing to the theme, in both color modes', async () => {
  const pair = (light, dark) => mode => (mode === 'light' ? light : dark)
  const colors = [
    // The token, the token faded, and one mix of two tokens in the same proportion in both modes.
    pair('#111111', '#eeeeee'),
    pair('rgba(0, 170, 0, 0.50)', 'rgba(51, 255, 51, 0.50)'),
    pair('#888888', '#777777'),
    // A literal; and a gray that is a mix in light mode but not in dark.
    pair('#3366cc', '#3366cc'),
    pair('#888888', '#888888'),
  ]
  const driver = styledDriver(mode => [
    ...colors.map((color, index) =>
      element(index, {colors: {color: color(mode)}, font: {size: 14, family: 'sans', weight: 400, text: 'ok'}}),
    ),
    // Categorical parts follow the palette, not the theme.
    element(10, {colors: {'background-color': '#123456'}, category: true}),
    element(11, {font: {size: 10, family: 'sans', weight: 400, text: 'tiny'}}),
    element(12, {font: {size: 15, family: 'serif', weight: 500, text: 'odd'}}),
    element(13, {font: {size: 11, family: 'sans', weight: 600, text: 'floor'}}),
    element(14, {
      spacing: {'padding-top': 5, 'padding-bottom': 5, 'margin-left': -8, 'padding-left': 1},
      radii: {'top-left': 5, 'top-right': 3, 'bottom-left': 'pill'},
      borders: {top: 1, left: 3},
    }),
  ])
  const results = await runChecks(driver, subject, {checks: ['palette', 'type-scale', 'spacing']})
  const by = Object.fromEntries(results.map(result => [result.id, result]))
  assert.deepEqual(
    results.map(result => result.status),
    ['fail', 'fail', 'fail'],
  )
  const palette = by.palette.details.join('\n')
  assert.match(palette, /span\.part3 color is #3366cc in light, #3366cc in dark, not a theme color/u)
  assert.match(palette, /span\.part4 color is #888888 in light, #888888 in dark/u)
  assert.doesNotMatch(palette, /part[0-2]\b|part10/u)
  // Measured in diff mode at full and phone width, each in light and dark: reported once per element and value.
  assert.equal(by.palette.details.filter(line => line.includes('part3')).length, 1)
  const type = by['type-scale'].details.join('\n')
  assert.match(type, /span\.part11 \("tiny"\) is 10px, below the 11px floor/u)
  assert.match(type, /span\.part12 \("odd"\) is 15px, not on the type scale \(11, 12, 13, 14 px\)/u)
  assert.match(type, /span\.part12 \("odd"\) is set in serif/u)
  assert.match(type, /span\.part12 \("odd"\) has font-weight 500/u)
  assert.doesNotMatch(type, /part13|part[0-4] /u)
  const spacing = by.spacing.details.join('\n')
  assert.match(spacing, /span\.part14 padding-top, padding-bottom are 5px, off the space scale \(0, 1, 2, 4, 8 px\)/u)
  assert.match(spacing, /span\.part14 border-top-right-radius is 3px, not a radius token/u)
  assert.match(spacing, /span\.part14 border-left-width is 3px, not a border-width token/u)
  assert.doesNotMatch(spacing, /margin-left|padding-left|top-left|bottom-left|border-top-width/u)
})

test('stage-surface passes a field on the stage or transparent and names whatever paints a lighter page', async () => {
  const stage = {light: '#efeee9', dark: '#0b0b0d'}
  const fieldDriver = paint => {
    let colorMode = 'light'
    return {
      async load(_subject, options) {
        colorMode = options.colorMode ?? 'light'
        return {status: 'ready', capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
      },
      async measure(call) {
        if (call !== 'stageSurface') return undefined
        const surface = ['top left', 'top right', 'left side', 'right side'].map(where => ({where, at: '2, 2', ...paint(where, colorMode)}))
        return {stage: stage[colorMode], samples: surface}
      },
      sleep: () => Promise.resolve(),
    }
  }
  const onStage = fieldDriver((where, mode) =>
    where === 'top right' ? {color: 'transparent', element: 'nothing (the host frame)'} : {color: stage[mode], element: 'div.view'},
  )
  const [passing] = await runChecks(onStage, subject, {checks: ['stage-surface']})
  assert.equal(passing.status, 'pass')
  const onPage = fieldDriver((where, mode) =>
    where === 'left side'
      ? {color: mode === 'light' ? '#fbfaf8' : '#101012', element: 'div.fp-stage'}
      : {color: stage[mode], element: 'div.view'},
  )
  const [failing] = await runChecks(onPage, subject, {checks: ['stage-surface']})
  assert.equal(failing.status, 'fail')
  assert.equal(failing.details.length, 2)
  assert.match(
    failing.details[0],
    /In diff mode \(light\), the field at its left side \(2, 2\) is #fbfaf8, painted by div\.fp-stage, not the stage \(#efeee9\)/u,
  )
  assert.match(failing.details[1], /In diff mode \(dark\), .* is #101012/u)
})

test('stage-insets passes equal insets, names uneven ones and skips fitted drawings and stages without cards', async () => {
  const insetDriver = measured => ({
    load: async () => ({status: 'ready', capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}),
    measure: async (call, _args) => (call === 'stageInsets' ? measured : undefined),
    sleep: () => Promise.resolve(),
  })
  const even = {cards: 1, first: 'div.panel', insets: {top: 12, right: 12, bottom: 12.4, left: 12}}
  const [passing] = await runChecks(insetDriver(even), subject, {checks: ['stage-insets']})
  assert.equal(passing.status, 'pass')
  const uneven = {cards: 2, first: 'section.group', insets: {top: 8, right: 12, bottom: 60, left: 12}}
  const [failing] = await runChecks(insetDriver(uneven), subject, {checks: ['stage-insets']})
  assert.equal(failing.status, 'fail')
  assert.equal(failing.details.length, 2)
  assert.match(
    failing.details[0],
    /^At full width, the cards on the stage \(section\.group and 1 more\) are 8px from the frame's top, 12px from its right, 60px from the content's end and 12px from its left/u,
  )
  assert.match(failing.details[1], /^At 390px/u)
  const [fitted] = await runChecks(insetDriver({cards: 0, fitted: 'div.canvas'}), subject, {checks: ['stage-insets']})
  assert.equal(fitted.status, 'skip')
  assert.match(fitted.details[0], /centres a fitted drawing \(div\.canvas\)/u)
  const overlaid = {cards: 1, first: 'div.panel', overlaid: 30, insets: {top: 30, right: 8, bottom: 8, left: 8}}
  const [clear] = await runChecks(insetDriver(overlaid), subject, {checks: ['stage-insets']})
  assert.equal(clear.status, 'pass')
  const under = {...overlaid, insets: {top: 8, right: 8, bottom: 8, left: 8}}
  const [covered] = await runChecks(insetDriver(under), subject, {checks: ['stage-insets']})
  assert.equal(covered.status, 'fail')
  assert.match(covered.details[0], /the host overlays the top 30px: stage-inset-top/u)
  const [bare] = await runChecks(insetDriver({cards: 0}), subject, {checks: ['stage-insets']})
  assert.equal(bare.status, 'skip')
})

test('an exempted subtree passes the styling checks and is listed with its reason', async () => {
  const driver = styledDriver(
    mode => [element(0, {colors: {color: mode === 'light' ? '#111111' : '#eeeeee'}})],
    ['div.heatmap: values are colored by magnitude'],
  )
  const [result] = await runChecks(driver, {mode: 'extraction', extraction: extraction(['a'])}, {checks: ['palette']})
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.details, ['Exempt (data-projections-off-system): div.heatmap: values are colored by magnitude'])
})

test('a summary the renderer sends must count what the documents have, per kind', async () => {
  const run = async summary => {
    const {driver} = fakeDriver(undefined)
    driver.state = () => ({selections: [], ...(summary ? {summary} : {})})
    const [result] = await runChecks(driver, subject, {checks: ['summary']})
    return result
  }
  const noun = {singular: 'item', plural: 'items'}
  assert.equal((await run(undefined)).status, 'skip')
  assert.equal((await run([{collection: 'entities', kind: 'item', noun, count: 2, added: 1}])).status, 'pass')
  const wrong = await run([
    {kind: 'item', noun, count: 3},
    {kind: 'ghost', noun: {singular: 'ghost', plural: 'ghosts'}, count: 1},
  ])
  assert.equal(wrong.status, 'fail')
  assert.match(wrong.details.join('\n'), /a total of 3 for "items" \(kind item\); the documents have 2/u)
  assert.match(wrong.details.join('\n'), /reports 0 added for "items" \(kind item\); the documents have 1/u)
  assert.match(wrong.details.join('\n'), /counts "ghosts" \(kind ghost\), which neither document has/u)
  const fact = {type: 'fact', id: 'new', noun: {singular: 'new item', plural: 'new items'}, count: 1}
  assert.equal(
    (
      await run([
        {...fact, ids: ['a']},
        {...fact, id: 'loose', count: 9},
      ])
    ).status,
    'pass',
  )
  const ghost = await run([{...fact, ids: ['a', 'ghost']}])
  assert.equal(ghost.status, 'fail')
  assert.match(ghost.details.join('\n'), /fact "new" names 1 item neither document has: ghost/u)
  // A fact's changes are part of what it counts.
  assert.equal((await run([{...fact, id: 'measure', count: 10, added: 4, removed: 6}])).status, 'pass')
  const over = await run([{...fact, count: 1, added: 2}])
  assert.equal(over.status, 'fail')
  assert.match(over.details.join('\n'), /fact "new" reports 2 added of a count of 1; what was added is part of the count/u)
})

test("one extraction's facts have no changes, and the summary is the same at every progress", async () => {
  const noun = {singular: 'rule', plural: 'rules'}
  const {driver} = fakeDriver(undefined)
  driver.state = () => ({selections: [], summary: [{type: 'fact', id: 'rules', noun, count: 1, added: 1}]})
  const [single] = await runChecks(driver, {mode: 'extraction', extraction: extraction(['a'])}, {checks: ['summary']})
  assert.equal(single.status, 'fail')
  assert.match(single.details.join('\n'), /fact "rules" reports added counts for one extraction, which has no changes/u)
  // A summary that follows the progress fails: the bar describes the whole comparison.
  const scrubbed = fakeDriver(undefined)
  let progress = 0
  const {seek} = scrubbed.driver
  scrubbed.driver.seek = async function (next) {
    progress = next
    return seek.call(this, next)
  }
  scrubbed.driver.state = () => ({selections: [], summary: [{type: 'fact', id: 'rules', noun, count: progress < 1 ? 0 : 1}]})
  const [moving] = await runChecks(scrubbed.driver, subject, {checks: ['summary']})
  assert.equal(moving.status, 'fail')
  assert.match(moving.details.join('\n'), /The summary changes while scrubbing/u)
})

test('frame-edges fails a rounded corner whose fill is painted over its edge, in either color mode, once', async () => {
  const frameDriver = covered => ({
    async load() {
      return {status: 'ready', steps: [], capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
    },
    async measure(call) {
      return call === 'frames' ? covered : undefined
    },
    sleep: () => Promise.resolve(),
  })
  const [passing] = await runChecks(frameDriver([]), subject, {checks: ['frame-edges']})
  assert.equal(passing.status, 'pass', passing.details.join('\n'))
  const [failing] = await runChecks(frameDriver([{element: 'div.stage', fill: 'p.note'}]), subject, {checks: ['frame-edges']})
  assert.equal(failing.status, 'fail')
  // The same finding in light and dark is one line.
  assert.deepEqual(failing.details, [
    "p.note fills a rounded corner of div.stage over its edge: draw the edge over it (the kit's `pk-frame`) (2 like it)",
  ])
  const [claimed] = await runChecks(frameDriver([{element: 'section.pk-group', rule: '.card::after { content }'}]), subject, {
    checks: ['frame-edges'],
  })
  assert.deepEqual(claimed.details, [
    '`.card::after { content }` draws in the `::after` of section.pk-group, a kit frame, which is its edge: draw it in an element of its own (2 like it)',
  ])
})

test('nested-accents fails a change color inside another, and lets an item keep its own emphasis', async () => {
  const paint = (painted, family, property, entity) => ({element: painted, family, property, ...(entity ? {entity} : {})})
  const accentDriver = nestings => ({
    async load() {
      return {status: 'ready', steps: [], capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
    },
    async measure(call) {
      return call === 'accents' ? nestings : undefined
    },
    sleep: () => Promise.resolve(),
  })
  const card = paint('li.card[data-entity-id="a"]', 'modified', 'background-color', 'a')
  const own = [
    // Its status word and icon in its own hue, and a same-hue mark of its own entity.
    {outer: card, inner: paint('span.status', 'modified', 'color', 'a')},
    {outer: card, inner: paint('span.icon', 'modified', 'background-color', 'a')},
  ]
  const [passing] = await runChecks(accentDriver(own), subject, {checks: ['nested-accents']})
  assert.equal(passing.status, 'pass', passing.details.join('\n'))
  const [failing] = await runChecks(
    accentDriver([
      ...own,
      {outer: card, inner: paint('ins.pill', 'added', 'background-color', 'a')},
      {outer: card, inner: paint('del.pill', 'removed', 'color')},
      // Another entity's surface or text in the same hue nests too.
      {outer: card, inner: paint('span.row[data-entity-id="b"]', 'modified', 'background-color', 'b')},
      {outer: card, inner: paint('span.name', 'modified', 'color', 'b')},
    ]),
    subject,
    {checks: ['nested-accents']},
  )
  assert.equal(failing.status, 'fail')
  assert.deepEqual(failing.details, [
    'In the diff: ins.pill (added background-color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
    'In the diff: del.pill (removed color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
    'In the diff: span.row[data-entity-id="b"] (modified background-color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
    'In the diff: span.name (modified color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
  ])
})

test('link-routes reports a link drawn across cards, and skips a renderer that routes none', async () => {
  const routesDriver = measurement => ({
    async load() {
      return {status: 'ready', steps: [], capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
    },
    async measure(call) {
      return call === 'routes' ? measurement : undefined
    },
    sleep: () => Promise.resolve(),
  })
  const [clear] = await runChecks(routesDriver({count: 3, crossing: []}), subject, {checks: ['link-routes']})
  assert.equal(clear.status, 'pass', clear.details.join('\n'))
  const [crossing] = await runChecks(routesDriver({count: 3, crossing: [{id: 'orders->payments', crosses: ['cache', 'audit']}]}), subject, {
    checks: ['link-routes'],
  })
  assert.equal(crossing.status, 'fail')
  assert.match(crossing.details[0], /^In the diff, no route around the cards exists for orders->payments: it is drawn across cache, audit/u)
  const [none] = await runChecks(routesDriver({count: 0, crossing: []}), subject, {checks: ['link-routes']})
  assert.equal(none.status, 'skip')
  // A probe without the routes call skips, rather than failing the run.
  const [unmeasured] = await runChecks(routesDriver(undefined), subject, {checks: ['link-routes']})
  assert.equal(unmeasured.status, 'skip')
  assert.match(unmeasured.details.join('\n'), /doesn't measure link routes/u)
})

test('nested-accents measures the animation in animated mode, after the diff', async () => {
  const calls = []
  const driver = {
    async load(_subject, options) {
      calls.push(`load ${options.comparisonMode ?? 'default'} ${options.progress}`)
      return {
        status: 'ready',
        steps: [0.5, 0.75, 1],
        capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff', 'animated']},
      }
    },
    async seek(progress) {
      calls.push(`seek ${progress}`)
      return {status: 'ready', steps: []}
    },
    async measure(call) {
      return call === 'accents' ? [] : undefined
    },
    sleep: () => Promise.resolve(),
  }
  const [result] = await runChecks(driver, subject, {checks: ['nested-accents']})
  assert.equal(result.status, 'pass')
  // The diff is measured first; the animation's first step is loaded in animated mode again, the next sought.
  assert.deepEqual(calls.slice(1), ['load animated 0', 'load diff 1', 'load animated 0.5', 'seek 0.75'])
})

test('a stage request the page never answers fails, naming it, the scenario and what the stage last said', async () => {
  const record = new StageRecord()
  record.scenario = 'graph/npm-express-5'
  const state = {status: 'ready', bundle: 'graph', comparisonMode: 'diff', progress: 1, rendered: 1, height: 1217, errors: []}
  assert.equal(await bounded(record, 'state', Promise.resolve(state), 1000), state)
  await assert.rejects(
    bounded(record, 'measure(settle)', new Promise(noop), 50),
    error =>
      /didn't answer measure\(settle\) for graph\/npm-express-5 within 0\.05 s/u.test(error.message) &&
      /status ready, renderer graph, diff, progress 1, painted 1, asked for 1217px; it last answered state/u.test(error.message),
  )
})

/** A page that emits Playwright's frame events, in an engine named `engine`. */
function fakePage(engine) {
  const listeners = {frameattached: [], framenavigated: []}
  const main = {name: 'main'}
  return {
    main,
    on: (event, listener) => listeners[event].push(listener),
    mainFrame: () => main,
    context: () => ({browser: () => ({browserType: () => ({name: () => engine})})}),
    emit: (event, frame) => listeners[event].forEach(listener => listener(frame)),
  }
}

test('a WebKit stage page starts over once it has started framesPerStagePage frames since it navigated', async () => {
  const {framesPerStagePage, framesSinceNavigation, stageNeedsFreshPage} = await import('../dist/playwright/frames.js')
  const webkit = fakePage('webkit')
  assert.equal(framesSinceNavigation(webkit), 0)
  for (let index = 0; index < framesPerStagePage - 1; index++) webkit.emit('frameattached', {})
  // A renderer frame navigating (to its opened document) is not the page navigating.
  webkit.emit('framenavigated', {})
  assert.equal(stageNeedsFreshPage(webkit), false)
  webkit.emit('frameattached', {})
  assert.equal(stageNeedsFreshPage(webkit), true)
  webkit.emit('framenavigated', webkit.main)
  assert.equal(framesSinceNavigation(webkit), 0)
  assert.equal(stageNeedsFreshPage(webkit), false)
  // Between check batches, any frame is one too many.
  assert.equal(stageNeedsFreshPage(webkit, 1), false)
  webkit.emit('frameattached', {})
  assert.equal(stageNeedsFreshPage(webkit, 1), true)

  const chromium = fakePage('chromium')
  framesSinceNavigation(chromium)
  for (let index = 0; index < framesPerStagePage * 4; index++) chromium.emit('frameattached', {})
  assert.equal(stageNeedsFreshPage(chromium), false)
})
