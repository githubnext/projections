import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {allChecks, checkTitles, runChecks} from '../dist/src/index.js'
import {checkFailures, connectInspector, samples, scenarioKeys} from '../dist/playwright/index.js'

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
  assert.equal(allChecks.length, 25)
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
      select() {},
      hover() {},
      state: () => ({selections: []}),
      async measure(call) {
        const unchanged = loads.at(-1).subject.comparison?.changes.length === 0
        if (call === 'samples')
          return mode === 'diff' ? [sample('a', unchanged ? 'plain' : 'tinted'), sample('b', 'plain')] : [sample('b', 'plain')]
        if (call === 'clipping') return clipped
        if (call === 'entities') return drawn
        if (call === 'overflow') return {scrollWidth: 300, clientWidth: 300, offenders: []}
        if (call === 'opening') return opening(loads.at(-1))
        return []
      },
      async compare() {
        return {protocolVersion: 0, changes: [], steps: []}
      },
      sleep: async () => {},
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
  assert.match(clipped[0].details[0], /10×0px/)
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
      /full width \(1280×650\), the diff: fitted, 3 entities in view, smallest text 9\.8px/.test(detail),
    ),
    fitted.result.details.join('\n'),
  )
  assert.ok(fitted.result.details.some(detail => /390px \(390×700\), side by side at After \(progress 1\): fitted.*4\.2px/.test(detail)))
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
    floored.result.details.some(detail => /at the 8px floor \(zoom 2, fitted text would be 4px\), opens on its top-left/.test(detail)),
  )
  // Opened zoomed further than the floor (the former 11 px floor), below it, where the fit was readable, or away
  // from its start: fails, naming the fix.
  const zoomed = await run(['diff'], load => [canvas(load, {zoom: 1.4, scrolls: true, smallestText: 11})])
  assert.equal(zoomed.result.status, 'fail')
  assert.match(zoomed.result.details[0], /opens zoomed \(1\.4\) further than the 8px floor \(smallest text 11px\)/)
  const small = await run(['diff'], load => [canvas(load, {zoom: 1.4, scrolls: true, smallestText: 7, outside})])
  assert.match(small.result.details[0], /with smallest text 7px, below the 8px floor, and not everything fits/)
  const readable = await run(['diff'], load => [canvas(load, {zoom: 1.2, scrolls: true, smallestText: 10})])
  assert.match(readable.result.details[0], /although fitted its smallest text would be 8\.33px, at least the 8px floor; open fitted/)
  const away = await run(['diff'], load => [
    canvas(load, {zoom: 2, scrolls: true, smallestText: 8, outside, start: {element: 'g.graph-node', corner: [-200, 300], inView: false}}),
  ])
  assert.match(away.result.details[0], /opens at the 8px floor scrolled away from the start of its content: g\.graph-node at \[-200, 300\]/)
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
    /with an entity cut off at the left or top edge of the visible canvas \[0, 0, 1280, 650\], for example g\.graph-node\[data-entity-id="vscode"\]/,
  )
  // A diff that doesn't fit may open on its changes instead of its start: zoomed past the floor only to fit them all.
  const start = {element: 'g.graph-node', corner: [-200, 300], inView: false}
  const changes = (count, inView, whole, smallestText) =>
    run(['diff'], load => [canvas(load, {zoom: 2, scrolls: true, smallestText, outside, start, changes: {count, inView, whole}})])
  const onChanges = await changes(3, 3, 3, 9.6)
  assert.equal(onChanges.result.status, 'pass', onChanges.result.details.join('\n'))
  assert.ok(onChanges.result.details.some(detail => /on its changes \(zoom 2\), 3 of 3 wholly in view/.test(detail)))
  assert.equal((await changes(3, 1, 1, 8)).result.status, 'pass')
  assert.match((await changes(3, 1, 1, 12)).result.details[0], /further than the 8px floor \(smallest text 12px\) with 2 of its 3 changes/)
  assert.match((await changes(3, 0, 0, 8)).result.details[0], /with none of its 3 changes in view/)
  // Below the floor but fitted, everything in view: passes (the phone frame above, at 4.2 px).
  const cut = await run(['diff'], load =>
    load.width ? [canvas(load, {outside: ['g.graph-node[data-entity-id="a"] at [400, 10, 520, 90]']})] : [canvas(load)],
  )
  assert.equal(cut.result.status, 'fail')
  assert.deepEqual(cut.result.details.length, 1)
  assert.match(
    cut.result.details[0],
    /^At 390px \(390×700\), the diff, 1 of 3 entities are outside the visible canvas \[0, 0, 390, 700\], for example g\.graph-node/,
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
  assert.match(missing.details[0], /calls:a->b/)
  assert.match(missing.details[0], /drawsRelationships: false/)
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
  assert.match(missing.details[0], /depends-on:a->c/)
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
    sleep: async () => {},
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
  assert.match(palette, /span\.part3 color is #3366cc in light, #3366cc in dark, not a theme color/)
  assert.match(palette, /span\.part4 color is #888888 in light, #888888 in dark/)
  assert.doesNotMatch(palette, /part[0-2]\b|part10/)
  // Measured in diff mode at full and phone width, each in light and dark: reported once per element and value.
  assert.equal(by.palette.details.filter(line => line.includes('part3')).length, 1)
  const type = by['type-scale'].details.join('\n')
  assert.match(type, /span\.part11 \("tiny"\) is 10px, below the 11px floor/)
  assert.match(type, /span\.part12 \("odd"\) is 15px, not on the type scale \(11, 12, 13, 14 px\)/)
  assert.match(type, /span\.part12 \("odd"\) is set in serif/)
  assert.match(type, /span\.part12 \("odd"\) has font-weight 500/)
  assert.doesNotMatch(type, /part13|part[0-4] /)
  const spacing = by.spacing.details.join('\n')
  assert.match(spacing, /span\.part14 padding-top, padding-bottom are 5px, off the space scale \(0, 1, 2, 4, 8 px\)/)
  assert.match(spacing, /span\.part14 border-top-right-radius is 3px, not a radius token/)
  assert.match(spacing, /span\.part14 border-left-width is 3px, not a border-width token/)
  assert.doesNotMatch(spacing, /margin-left|padding-left|top-left|bottom-left|border-top-width/)
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
        const samples = ['top left', 'top right', 'left side', 'right side'].map(where => ({where, at: '2, 2', ...paint(where, colorMode)}))
        return {stage: stage[colorMode], samples}
      },
      sleep: async () => {},
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
    /In diff mode \(light\), the field at its left side \(2, 2\) is #fbfaf8, painted by div\.fp-stage, not the stage \(#efeee9\)/,
  )
  assert.match(failing.details[1], /In diff mode \(dark\), .* is #101012/)
})

test('stage-insets passes equal insets, names uneven ones and skips fitted drawings and stages without cards', async () => {
  const insetDriver = measured => ({
    load: async () => ({status: 'ready', capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}),
    measure: async (call, _args) => (call === 'stageInsets' ? measured : undefined),
    sleep: async () => {},
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
    /^At full width, the cards on the stage \(section\.group and 1 more\) are 8px from the frame's top, 12px from its right, 60px from the content's end and 12px from its left/,
  )
  assert.match(failing.details[1], /^At 390px/)
  const [fitted] = await runChecks(insetDriver({cards: 0, fitted: 'div.canvas'}), subject, {checks: ['stage-insets']})
  assert.equal(fitted.status, 'skip')
  assert.match(fitted.details[0], /centres a fitted drawing \(div\.canvas\)/)
  const overlaid = {cards: 1, first: 'div.panel', overlaid: 30, insets: {top: 30, right: 8, bottom: 8, left: 8}}
  const [clear] = await runChecks(insetDriver(overlaid), subject, {checks: ['stage-insets']})
  assert.equal(clear.status, 'pass')
  const under = {...overlaid, insets: {top: 8, right: 8, bottom: 8, left: 8}}
  const [covered] = await runChecks(insetDriver(under), subject, {checks: ['stage-insets']})
  assert.equal(covered.status, 'fail')
  assert.match(covered.details[0], /the host overlays the top 30px: stage-inset-top/)
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
  assert.match(wrong.details.join('\n'), /a total of 3 for "items" \(kind item\); the documents have 2/)
  assert.match(wrong.details.join('\n'), /reports 0 added for "items" \(kind item\); the documents have 1/)
  assert.match(wrong.details.join('\n'), /counts "ghosts" \(kind ghost\), which neither document has/)
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
  assert.match(ghost.details.join('\n'), /fact "new" names 1 item neither document has: ghost/)
  // A fact's changes are part of what it counts.
  assert.equal((await run([{...fact, id: 'measure', count: 10, added: 4, removed: 6}])).status, 'pass')
  const over = await run([{...fact, count: 1, added: 2}])
  assert.equal(over.status, 'fail')
  assert.match(over.details.join('\n'), /fact "new" reports 2 added of a count of 1; what was added is part of the count/)
})

test("one extraction's facts have no changes, and the summary is the same at every progress", async () => {
  const noun = {singular: 'rule', plural: 'rules'}
  const {driver} = fakeDriver(undefined)
  driver.state = () => ({selections: [], summary: [{type: 'fact', id: 'rules', noun, count: 1, added: 1}]})
  const [single] = await runChecks(driver, {mode: 'extraction', extraction: extraction(['a'])}, {checks: ['summary']})
  assert.equal(single.status, 'fail')
  assert.match(single.details.join('\n'), /fact "rules" reports added counts for one extraction, which has no changes/)
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
  assert.match(moving.details.join('\n'), /The summary changes while scrubbing/)
})

test('nested-accents fails a change color inside another, and lets an item keep its own emphasis', async () => {
  const paint = (element, family, property, entity) => ({element, family, property, ...(entity ? {entity} : {})})
  const accentDriver = nestings => ({
    async load() {
      return {status: 'ready', steps: [], capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}}
    },
    async measure(call) {
      return call === 'accents' ? nestings : undefined
    },
    sleep: async () => {},
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
      // Another entity's surface in the same hue nests too.
      {outer: card, inner: paint('span.row[data-entity-id="b"]', 'modified', 'background-color', 'b')},
    ]),
    subject,
    {checks: ['nested-accents']},
  )
  assert.equal(failing.status, 'fail')
  assert.deepEqual(failing.details, [
    'In the diff: ins.pill (added background-color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
    'In the diff: del.pill (removed color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
    'In the diff: span.row[data-entity-id="b"] (modified background-color) is drawn inside li.card[data-entity-id="a"] (modified background-color)',
  ])
})
