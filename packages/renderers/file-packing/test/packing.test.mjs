import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {
  categoryPalette,
  comparisonModel,
  extractionModel,
  fileCategory,
  paletteLegend,
  scheduleSteps,
} from '@githubnext/projections-renderer-kit'
import {languageColor, languageNamed} from '@githubnext/projections-renderer-sdk/languages'
import {defaultThemeTokens} from '@githubnext/projections-renderer-sdk/protocol'
import {categoryOf, excluded, flagsOf, formatDelta, formatSize, legendTitle, weightOf} from '../node_modules/.cache/test/files.js'
import {listWords, packingDocument, packingPalette, withHolders} from '../node_modules/.cache/test/document.js'
import {flagDots} from '../node_modules/.cache/test/circles.js'
import {packSnapshot} from '../node_modules/.cache/test/pack/packing.js'
import {createPackingTransition, diffPacking} from '../node_modules/.cache/test/transition.js'
import {sideSnapshot} from '../node_modules/.cache/test/snapshots.js'
import {depthControl, folderControls} from '../node_modules/.cache/test/controls.js'
import {placeLabels} from '../node_modules/.cache/test/labels.js'

const engine = createNativeEngine()
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const settings = {weight: entity => weightOf(entity, 'bytes'), category: entity => categoryOf(entity, 'files').key, maxDepth: 12}
const area = {width: 1200, height: 720}

async function sample() {
  const before = fixture('sample-before'),
    after = fixture('sample-after')
  const model = comparisonModel(before, after, await engine.compare(before, after))
  return {before, after, model, schedule: scheduleSteps(model)}
}

/** Visible circles that partly overlap: neither apart nor nested. */
function overlaps(circles, tolerance = 1) {
  const found = []
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i],
        b = circles[j]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const nested = distance + Math.min(a.r, b.r) <= Math.max(a.r, b.r) + tolerance
      if (!nested && distance < a.r + b.r - tolerance) found.push(`${a.id} / ${b.id}`)
    }
  return found
}

test('extensions, categories and sizes are read the way repository-map writes them', () => {
  assert.equal(fileCategory('src/view.TSX').key, 'TypeScript', 'TSX is presented as TypeScript')
  assert.equal(fileCategory('docs/Makefile').key, 'Makefile')
  assert.equal(fileCategory('assets/logo.PNG').key, '.png')
  assert.deepEqual(fileCategory('LICENSE.unknownext'), {key: '.unknownext', label: '.unknownext'})
  assert.deepEqual(fileCategory('bin/run'), {key: 'none', label: 'No extension'})
  assert.equal(weightOf({id: 'a', kind: 'file', label: 'a', data: {size: 120, lines: 4}}, 'bytes'), 120)
  assert.equal(weightOf({id: 'a', kind: 'file', label: 'a', data: {size: 120, lines: 4}}, 'lines'), 4)
  assert.equal(weightOf({id: 'b', kind: 'file', label: 'b', data: {size: 9}}, 'lines'), 0, 'a binary file has no lines')
  assert.equal(weightOf({id: 'c', kind: 'module', label: 'c', data: {value: 7}}, 'bytes'), 7)
  assert.equal(formatSize(512, 'bytes'), '512 B')
  assert.equal(formatSize(1536, 'bytes'), '1.5 KB')
  assert.equal(formatSize(3 * 1024 * 1024, 'bytes'), '3 MB')
  assert.equal(formatSize(1, 'lines'), '1 line')
  assert.equal(formatDelta(-340, 'bytes'), '−340 B')
  assert.equal(formatDelta(2048, 'bytes'), '+2 KB')
  const rules = {dependencies: true, lockfiles: true, hidden: new Set(['docs'])}
  assert.ok(excluded('web/node_modules/react/index.js', rules))
  assert.ok(excluded('rust/Cargo.lock', rules))
  assert.ok(excluded('docs/guide.md', rules))
  assert.ok(!excluded('src/build.ts', rules), 'only whole path segments name build output')
})

test('languages take their Linguist colors; data and docs take distinct palette slots; gray is only for the rest', () => {
  const files = [
    ['src/app.ts', 900],
    ['src/view.tsx', 300],
    ['package-lock.json', 600],
    ['README.md', 50],
    ['config.yml', 40],
    ['notes.weird', 10],
  ]
  const categories = files.map(([path, weight]) => ({category: fileCategory(path), weight}))
  const palette = categoryPalette(categories, 'light')
  assert.deepEqual(
    palette.ranked.map(entry => entry.category.key),
    ['TypeScript', 'JSON', 'Markdown', 'YAML', '.weird'],
    'TSX joins TypeScript; JSON outweighs Markdown',
  )
  const typescript = languageColor(languageNamed('TypeScript'), 'light')
  assert.deepEqual(palette.entry('TypeScript').swatch, {color: typescript}, 'TypeScript takes its calibrated Linguist blue')
  assert.equal(palette.paintOf('TypeScript'), typescript)
  for (const key of ['JSON', 'Markdown', 'YAML', '.weird']) assert.ok(palette.entry(key).slot > 0, `${key} has a palette color, not gray`)
  assert.equal(new Set(palette.ranked.map(entry => entry.paint)).size, 5)
  assert.deepEqual(categoryPalette([...categories].reverse(), 'light').ranked, palette.ranked, 'order never matters')
  const dark = categoryPalette(categories, 'dark')
  for (const entry of palette.ranked)
    assert.equal(dark.entry(entry.category.key).slot, entry.slot, `${entry.category.key} keeps its slot in dark`)
  const many = categoryPalette(
    Array.from({length: 20}, (_, index) => ({category: fileCategory(`x.e${index}`), weight: 100 - index})),
    'light',
  )
  assert.equal(many.ranked.filter(entry => entry.slot === 0).length, 4, 'past sixteen types the rest share the neutral color')
  const legend = paletteLegend(many, legendTitle('files', 'bytes'))
  assert.equal(legend.items.at(-1).label, '6 other types')
  assert.equal(legend.title, 'Languages and file types, sized by bytes')
  assert.deepEqual(paletteLegend(palette, 'x').items[0], {label: 'TypeScript', color: typescript, shape: 'circle'})
})

test('a packing is deterministic, fills its area, nests files in folders and sizes them by weight', () => {
  const after = fixture('sample-after')
  const model = extractionModel(after)
  const first = packSnapshot(sideSnapshot(model, 'after'), settings, area)
  const second = packSnapshot(sideSnapshot(model, 'after'), settings, area)
  assert.deepEqual([...first.placements], [...second.placements])
  assert.equal(first.root, 'directory:.', 'the single root is the background, not a circle')
  assert.ok(!first.placements.has('directory:.'))
  const circles = [...first.placements].map(([id, placement]) => ({id, ...placement}))
  assert.deepEqual(overlaps(circles), [])
  for (const circle of circles) {
    assert.ok(circle.x - circle.r >= -0.5 && circle.x + circle.r <= area.width + 0.5, `${circle.id} stays inside the width`)
    assert.ok(circle.y - circle.r >= -0.5 && circle.y + circle.r <= area.height + 0.5, `${circle.id} stays inside the height`)
    if (circle.parent) {
      const parent = first.placements.get(circle.parent)
      assert.ok(Math.hypot(circle.x - parent.x, circle.y - parent.y) + circle.r <= parent.r + 0.5, `${circle.id} is inside its folder`)
    }
  }
  const fill = Math.max(first.bounds.width / (area.width - 16), first.bounds.height / (area.height - 16))
  assert.ok(fill > 0.99 && fill < 1.01, 'the packing fills the area along its tighter side')
  const r = id => first.placements.get(id).r
  assert.ok(Math.abs((r('file:src/api/client.ts') / r('file:src/api/types.ts')) ** 2 - 4930 / 1780) < 1e-6, 'area follows bytes')
})

test('the depth limit collapses deeper folders into one circle of their heaviest type', () => {
  const model = extractionModel(fixture('sample-after'))
  const packing = packSnapshot(sideSnapshot(model, 'after'), {...settings, maxDepth: 1}, area)
  const src = packing.placements.get('directory:src')
  assert.equal(src.filled, true)
  assert.equal(src.category, 'TypeScript', 'TypeScript (with TSX) outweighs CSS in src')
  assert.ok(!packing.placements.has('file:src/main.ts'))
  assert.equal(src.value, 4930 + 1780 + 640 + 4120 + 1490 + 1320 + 2290 + 3010 + 2050 + 2760 + 3120 + 1940 + 3650 + 1290)
})

test('a sibling keeps its place when another file in its folder changes', () => {
  const after = fixture('sample-after')
  const grown = structuredClone(after)
  grown.entities.find(entity => entity.id === 'file:src/components/Filters.tsx').data.size *= 3
  const place = extraction => {
    const packing = packSnapshot(sideSnapshot(extractionModel(extraction), 'after'), settings, area)
    const folder = packing.placements.get('directory:src/components')
    const child = packing.placements.get('file:src/components/Button.tsx')
    return Math.atan2(child.y - folder.y, child.x - folder.x)
  }
  const turn = Math.abs(place(after) - place(grown))
  assert.ok(Math.min(turn, 2 * Math.PI - turn) < Math.PI / 3, 'Button.tsx stays on the same side of its folder')
})

test('the before endpoint is that revision packed alone, and the after endpoint continues from it', async () => {
  const {model, schedule, before, after} = await sample()
  const transition = createPackingTransition(model, schedule, settings, area)
  const alone = packSnapshot(sideSnapshot(model, 'before'), settings, area)
  const first = transition.frame(0)
  assert.equal(first.length, before.entities.length - 1, 'every entity but the background root is a circle')
  for (const circle of first) {
    const expected = alone.placements.get(circle.id)
    assert.ok(Math.abs(circle.x - expected.x) < 1e-9 && Math.abs(circle.y - expected.y) < 1e-9 && Math.abs(circle.r - expected.r) < 1e-9)
    assert.equal(circle.opacity, 1)
  }
  const last = transition.frame(1)
  assert.deepEqual(
    last.map(circle => circle.id).sort(),
    after.entities
      .map(entity => entity.id)
      .filter(id => id !== 'directory:.')
      .sort(),
  )
  assert.deepEqual(overlaps(last), [])
  // Continuing from the before packing keeps unchanged files closer to where they were than packing the after revision alone.
  const cold = packSnapshot(sideSnapshot(model, 'after'), settings, area)
  const drift = placements =>
    model.entities
      .filter(row => row.status === 'unchanged' && row.before && placements.has(row.id) && alone.placements.has(row.id))
      .reduce((sum, row) => {
        const a = alone.placements.get(row.id),
          b = placements.get(row.id)
        return sum + Math.hypot(a.x - b.x, a.y - b.y)
      }, 0)
  assert.ok(drift(transition.last.placements) < drift(cold.placements), 'unchanged files move less')
})

test('removals fade before their room closes, additions get room before they fade in, and nothing collides', async () => {
  const {model, schedule} = await sample()
  const transition = createPackingTransition(model, schedule, settings, area)
  const at = (progress, id) => transition.frame(progress).find(circle => circle.id === id)
  const removal = schedule.find(step => step.kind === 'remove')
  const addition = schedule.find(step => step.entities.includes('file:src/components/Filters.tsx'))
  const removed = 'file:src/vendor/moment.js',
    added = 'file:src/components/Filters.tsx'
  const start = at(0, removed)
  let faded = false
  for (let index = 0; index <= 400; index++) {
    const progress = removal.time - removal.radius + (index / 400) * 2 * removal.radius
    const circle = at(progress, removed)
    if (!circle) {
      faded = true
      continue
    }
    if (circle.opacity > 0.01) {
      assert.ok(!faded, 'a removal never reappears')
      assert.ok(Math.abs(circle.r - start.r) < 1e-6, 'a removal keeps its size while it fades')
    }
  }
  assert.ok(faded)
  const end = at(1, added)
  let shown = false
  for (let index = 0; index <= 400; index++) {
    const progress = addition.time - addition.radius + (index / 400) * 2 * addition.radius
    const circle = at(progress, added)
    if (circle && circle.opacity > 0.01) {
      shown = true
      assert.ok(Math.abs(circle.r - end.r) < 1e-6, 'an addition fades in only once its room is open')
    }
  }
  assert.ok(shown)
  for (let index = 0; index <= 500; index++) {
    const progress = index / 500
    const visible = transition.frame(progress).filter(circle => circle.opacity > 0.01)
    assert.deepEqual(overlaps(visible), [], `no circles collide at ${progress}`)
  }
})

test('a frame is a pure function of progress, whatever the order of seeks', async () => {
  const {model, schedule} = await sample()
  const transition = createPackingTransition(model, schedule, settings, area)
  const forward = Array.from({length: 51}, (_, index) => JSON.stringify(transition.frame(index / 50)))
  const backward = Array.from({length: 51}, (_, index) => JSON.stringify(transition.frame((50 - index) / 50))).reverse()
  assert.deepEqual(forward, backward)
})

test('the diff packs both revisions at the after scale, so unchanged files keep their size', async () => {
  const {model} = await sample()
  const {circles, after} = diffPacking(model, settings, area)
  const ids = new Set(circles.map(circle => circle.id))
  assert.ok(ids.has('file:src/vendor/moment.js') && ids.has('file:src/search/rank.ts'), 'removed and added files are both drawn')
  for (const circle of circles.filter(circle => circle.row.status === 'unchanged' && circle.filled))
    assert.ok(Math.abs(circle.r - after.placements.get(circle.id).r) < 1e-9, `${circle.id} keeps its size`)
  assert.deepEqual(overlaps(circles), [])
})

test('labels never overlap and controls follow the document', async () => {
  const {model, schedule} = await sample()
  const transition = createPackingTransition(model, schedule, settings, area)
  const circles = transition.frame(1)
  const decorations = placeLabels(circles, new Map(), 7.44, 12)
  assert.ok([...decorations.values()].filter(decoration => decoration.text).length > 5)
  assert.equal(decorations.get('file:src/api/client.ts').text, 'client.ts')
  assert.equal(decorations.get('file:src/api/client.ts').status, 'line', 'a large changed file states its status below its name')
  const {controls, ids} = folderControls(['.github', 'docs', 'my folder', 'my-folder'])
  assert.deepEqual(
    controls.map(control => control.id),
    ['show.github', 'show.docs', 'show.my-folder', 'show.my-folder-2'],
  )
  assert.equal(ids.get('my folder'), 'show.my-folder')
  assert.deepEqual(folderControls(['src']).controls, [], 'one folder needs no control')
  assert.deepEqual({max: depthControl(5).max, default: depthControl(5).default}, {max: 5, default: 5})
})

const settingsMap = async () => {
  const before = fixture('settings-before'),
    after = fixture('settings-after')
  return comparisonModel(before, after, await engine.compare(before, after))
}

test("kinds take the definition's colors as theme tokens, and the rest the most distinct free slots", async () => {
  const model = await settingsMap()
  const doc = packingDocument(model)
  assert.equal(doc.mode, 'kind')
  assert.equal(doc.flags, true, 'the settings map carries flags')
  const kinds = {secret: {color: 'danger'}, 'pre-release': {color: 'warning'}, setting: {color: 'neutral'}}
  const palette = packingPalette(model, undefined, doc, 'bytes', 'light', kinds)
  assert.deepEqual(palette.entry('secret').swatch, {token: 'chart-11'}, 'danger is the red categorical hue')
  assert.deepEqual(palette.entry('pre-release').swatch, {token: 'chart-15'}, 'warning is the amber categorical hue')
  assert.deepEqual(palette.entry('setting').swatch, {token: 'color-border-emphasis'}, 'neutral is the neutral token')
  const slots = palette.ranked.map(entry => entry.slot).filter(Boolean)
  assert.equal(new Set(slots).size, slots.length, 'no two kinds share a slot, so assigned kinds keep clear of pinned ones')
  const legend = paletteLegend(palette, legendTitle(doc.mode, 'bytes', doc.flags))
  assert.equal(legend.title, 'Kinds, with flags as dots, sized by weight')
  assert.ok(
    legend.items.some(item => item.label === 'setting'),
    'a kind pinned to the neutral color keeps its own legend item',
  )

  // Without definition colors, no two kinds are near each other (the hidden and not-patchable greens of ordered slots).
  const free = packingPalette(model, undefined, doc, 'bytes', 'light')
  const tokens = defaultThemeTokens('light')
  const kindSlots = ['setting', 'hidden', 'secret', 'pre-release', 'not-patchable'].map(key => free.entry(key).slot)
  assert.equal(new Set(kindSlots).size, 5)
  const lab = hex => {
    const linear = [1, 3, 5]
      .map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    const [l, m, s2] = [
      0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2],
      0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2],
      0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2],
    ].map(Math.cbrt)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2,
    ]
  }
  let closest = Infinity
  for (const a of kindSlots)
    for (const b of kindSlots)
      if (a < b) closest = Math.min(closest, Math.hypot(...lab(tokens[`chart-${a}`]).map((v, i) => v - lab(tokens[`chart-${b}`])[i])))
  assert.ok(closest > 0.09, `the closest two kinds are ${closest.toFixed(3)} apart`)
})

test('flags are the attributes besides a kind, drawn as dots inside the circle and named in words', () => {
  assert.deepEqual(flagsOf({id: 'k', kind: 'secret', label: 'k', data: {flags: ['secret', 'hidden', 'hidden', 3, 'pre-release']}}), [
    'hidden',
    'pre-release',
  ])
  assert.deepEqual(flagsOf({id: 'k', kind: 'setting', label: 'k', data: {}}), [])
  assert.deepEqual(flagDots(4, 2), [], 'tiny circles carry no dots; their accessible name does')
  for (const r of [6, 8, 14, 40]) {
    const dots = flagDots(r, 3)
    assert.ok(dots.length >= (r >= 14 ? 3 : 1), `as many dots as fit at r ${r}`)
    for (const dot of dots) assert.ok(Math.hypot(dot.x, dot.y) + dot.r <= r - 1.5 + 1e-9, `a dot stays inside the change ring at r ${r}`)
    for (let index = 1; index < dots.length; index++) assert.ok(dots[index].x - dots[index - 1].x >= 2 * dots[index].r, 'dots never touch')
  }
  assert.equal(flagDots(20, 9).length, 4, 'at most four dots')
  assert.equal(listWords(['hidden']), 'hidden')
  assert.equal(listWords(['hidden', 'secret', 'pre-release']), 'hidden, secret and pre-release')
})

test("a folder whose top is taken by its parent's name is named along its bottom, and a long name is abbreviated", () => {
  const row = (id, label) => ({id, status: 'unchanged', before: {id, kind: 'group', label}, after: {id, kind: 'group', label}})
  const circle = (id, label, x, y, r, depth) => ({id, row: row(id, label), x, y, r, depth, filled: false, local: 1, opacity: 1, value: 1})
  const parent = circle('providers', 'providers', 0, 0, 200, 1)
  // The child's top touches the parent's: its name there would overlap "providers".
  const child = circle('atlas', 'atlas', 0, -150, 50, 2)
  const decorations = placeLabels([parent, child], new Map(), 7.44, 12)
  assert.deepEqual([decorations.get('providers').text, decorations.get('providers').arc], ['providers', 'top'])
  assert.deepEqual([decorations.get('atlas').text, decorations.get('atlas').arc], ['atlas', 'bottom'])
  // With its bottom taken too (a sibling's name runs along the sibling's top), it is named inside, abbreviated.
  const sibling = circle('ember', 'ember', 0, -40, 60, 2)
  const wedged = placeLabels([parent, child, sibling], new Map(), 7.44, 12).get('atlas')
  assert.equal(wedged.arc, 'inside')
  assert.ok(wedged.text.startsWith('atl') && wedged.labelY < 0, `named inside its top edge (${wedged.text} at ${wedged.labelY})`)
  // A phone's smaller folder, too small for those lines to hold an abbreviation: named inside where one fits.
  const small = circle('borealis', 'borealis', 0, -172.5, 27.5, 2)
  const below = circle('glacier', 'glacier', 0, -90, 55, 2)
  const phone = placeLabels([parent, small, below], new Map(), 7.44, 12).get('borealis')
  assert.equal(phone.arc, 'inside')
  assert.ok(phone.text?.startsWith('bor') && phone.text.length >= 4, `named inside (${phone.text} at ${phone.labelY})`)
  const long = circle('long', 'aVeryLongProviderNameIndeed', 0, 0, 40, 1)
  const named = placeLabels([long], new Map(), 7.44, 12).get('long')
  assert.ok(named.text.endsWith('…') && named.text.length >= 4, `a long name is abbreviated (${named.text})`)
  assert.equal(placeLabels([circle('tiny', 'tiny', 0, 0, 20, 1)], new Map(), 7.44, 12).get('tiny').text, undefined)
})

test('folders with an emphasized change inside them, at any depth, hold changes: their ring is drawn neutral', () => {
  const drawn = (id, parent, changed, emphasis = 1) => ({id, circle: {parent}, changed, emphasis, holdsChanges: false})
  const holding = items =>
    withHolders(items)
      .filter(item => item.holdsChanges)
      .map(item => item.id)
  assert.deepEqual(
    holding([
      drawn('src', undefined, true),
      drawn('src/api', 'src', false),
      drawn('src/api/a.ts', 'src/api', true),
      drawn('docs', undefined, true),
    ]),
    ['src', 'src/api'],
  )
  // A change not emphasized yet leaves its folders plain.
  assert.deepEqual(holding([drawn('src', undefined, true), drawn('src/a.ts', 'src', true, 0)]), [])
})
