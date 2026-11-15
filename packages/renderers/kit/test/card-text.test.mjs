import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {
  cardFooterHeight,
  cardHeight,
  cardIconNames,
  cardIconRoom,
  cardWidthRange,
  comparisonModel,
  createGraphTransition,
  cutText,
  diffCardText,
  entityKindLine,
  extractionModel,
  isCardIconName,
  graphCardsWidth,
  graphCardWidth,
  kindText,
  scheduleSteps,
} from '../dist/index.js'
import {compare, entity, extraction, relationship} from './engine.mjs'

const one = (fields = {}) => ({after: {id: 'a', kind: 'service', label: 'api', ...fields}})

test('a card is as wide as its text needs, between the narrowest and widest card', () => {
  // Short text: the narrowest card.
  assert.equal(graphCardWidth(one()), cardWidthRange.min)
  // A label in monospace: 7.4 units a character at the default size, between 16-unit insets, rounded up to 4.
  assert.equal(graphCardWidth(one({label: 'payments-gateway-v2'})), Math.ceil((32 + 19 * 7.4) / 4) * 4)
  // A kind line with its note, and the detail at its right.
  const kindLine = () => ({text: 'Workspace', note: '+2'})
  const detail = () => '10.12.4'
  const width = graphCardWidth(one(), {kindLine, detail})
  assert.equal(width, Math.ceil((32 + 9 * 6.6 + ' · +2'.length * 6.6 + 8 + 7 * 7.4) / 4) * 4)
  // A file's text starts after its icon.
  assert.equal(graphCardWidth({after: {id: 'f', kind: 'file', label: 'src/gateway.ts'}}), Math.ceil((40 + 14 * 7.4 + 16) / 4) * 4)
  // Longer text is cut at the widest card.
  assert.equal(graphCardWidth(one({label: 'x'.repeat(60)})), cardWidthRange.max)
  // A smaller type size needs less room: VS Code's 11 px over the default 12.
  assert.ok(graphCardWidth(one({label: 'payments-gateway-v2'}), {textScale: 11 / 12}) < graphCardWidth(one({label: 'payments-gateway-v2'})))
})

test('in a comparison a card makes room for its status footer, and both revisions', () => {
  const status = () => [{status: 'modified', glyph: '~', icon: 'modified', label: 'Update in place'}]
  const row = {status: 'modified', before: {id: 'a', kind: 'service', label: 'db'}, after: {id: 'a', kind: 'service', label: 'db'}}
  assert.equal(graphCardWidth(row), cardWidthRange.min, 'one revision has no status')
  assert.equal(graphCardWidth(row, {comparing: true, status}), Math.ceil((32 + 12 + 2.5 + 15 * 6.5) / 4) * 4)
  // A renamed card is as wide as its longer name.
  const renamed = {
    status: 'unchanged',
    renamed: true,
    before: {id: 'a', kind: 'service', label: 'a'},
    after: {id: 'a', kind: 'service', label: 'a-much-longer-name'},
  }
  assert.equal(graphCardWidth(renamed), graphCardWidth({after: renamed.after}))
})

test("a graph's cards share the width its widest text needs", () => {
  const rows = ['api', 'payments-gateway-v2', 'db'].map(label => ({after: {id: label, kind: 'service', label}}))
  assert.equal(graphCardsWidth(rows), graphCardWidth(rows[1]))
  assert.equal(graphCardsWidth([]), cardWidthRange.min)
})

test('text cut short keeps its start, and a kind line its end', () => {
  assert.equal(cutText('payments', 20), 'payments')
  assert.equal(cutText('@typescript-eslint/eslint-plugin', 12), '@typescript…')
  assert.equal(kindText('Microsoft.Compute/virtualMachines/extensions', 22), '…/extensions')
  assert.equal(kindText('aws_secretsmanager_secret_version', 12), '…ret_version')
})

test('cards keep one width through a transition, and one revision has no status footer', async () => {
  const before = extraction('graph/v0', [entity('api', 'service'), entity('db', 'database')], [relationship('api->db', 'api', 'db')])
  const after = extraction(
    'graph/v0',
    [entity('api', 'service'), entity('db', 'database'), entity('payments-gateway-v2', 'service')],
    [relationship('api->db', 'api', 'db'), relationship('pay->db', 'payments-gateway-v2', 'db')],
  )
  const model = comparisonModel(before, after, await compare(before, after))
  const width = graphCardsWidth(model.entities, {comparing: true})
  const widths = new Map(model.entities.map(row => [row.id, width]))
  const transition = await createGraphTransition(model, scheduleSteps(model), {widths})
  for (let index = 0; index <= 50; index++)
    for (const node of transition(index / 50).nodes) {
      assert.equal(node.width, width, `${node.id} at ${index / 50}`)
      assert.equal(node.height, cardHeight(node.after?.kind ?? node.before.kind), `${node.id} has its footer`)
    }
  const single = await createGraphTransition(extractionModel(after), [], {widths})
  for (const node of single(1).nodes) assert.equal(node.height, cardHeight(node.after.kind) - cardFooterHeight, `${node.id}: no footer`)
})

test('badges wrap into rows within the card, a lone overlong one ends in an ellipsis, and the card grows a row per row', async () => {
  const {placeBadges, badgeMetrics} = await import('../dist/index.js')
  const placed = placeBadges(['network', 'jsonValue', 'filesystem', 'x'], 160)
  assert.deepEqual(
    placed.map(badge => badge.row),
    [0, 0, 1, 1],
  )
  for (const badge of placed) assert.ok(badge.x + badge.width <= 160 + 1e-9, `${badge.text} fits its row`)
  const [long] = placeBadges(['a'.repeat(80)], 160)
  assert.ok(long.text.endsWith('…') && long.width <= 160)
  // A highlight's pill makes room for its icon; quiet tags have no pill and start a row of their own after the pills.
  const toned = placeBadges([{text: 'proved', tone: 'highlight'}, 'x', {text: 'cli', tone: 'quiet'}, {text: 'wasm', tone: 'quiet'}], 400)
  assert.deepEqual(
    toned.map(badge => [badge.tone, badge.row]),
    [
      ['highlight', 0],
      [undefined, 0],
      ['quiet', 1],
      ['quiet', 1],
    ],
  )
  assert.equal(toned[0].width, Math.round(6 * 7 * 1e6) / 1e6 + 2 * badgeMetrics.inset + badgeMetrics.icon + badgeMetrics.iconGap)
  assert.equal(toned[2].width, 3 * 7.4)
  // A card with two rows of badges is laid out two rows taller in every frame of a transition.
  const doc = tags =>
    extraction('graph/v0', [entity('a', 'service', {data: {tags}}), entity('b', 'service')], [relationship('r', 'a', 'b', 'calls')])
  const before = doc(['one']),
    after = doc(['one', 'two'])
  const model = comparisonModel(before, after, await compare(before, after))
  const grow = new Map([['a', 2 * badgeMetrics.row]])
  const transition = await createGraphTransition(model, scheduleSteps(model), {grow})
  for (const t of [0, 0.5, 1]) {
    const nodes = transition(t).nodes
    assert.equal(nodes.find(node => node.id === 'a').height, cardHeight('service') + 2 * badgeMetrics.row)
    assert.equal(nodes.find(node => node.id === 'b').height, cardHeight('service'))
  }
})

test('a kind reads in sentence case, except a name written in lowercase', () => {
  assert.deepEqual(entityKindLine('data-source'), {text: 'Data source'})
  assert.deepEqual(entityKindLine('rust-crate'), {text: 'Rust crate'})
  assert.deepEqual(entityKindLine('npm-package'), {text: 'npm package'})
  assert.deepEqual(entityKindLine('pnpm_workspace'), {text: 'pnpm workspace'})
  // Only a whole first word keeps its case: `npmrc` is no name written in lowercase.
  assert.deepEqual(entityKindLine('npmrc-file'), {text: 'Npmrc file'})
})

test("a card's kind line makes room for its icon, and only a known icon takes room", () => {
  assert.ok(isCardIconName('terminal') && cardIconNames.includes('git-compare'))
  for (const name of ['', 'Terminal', 'not-an-icon', '<svg>', 'constructor', 'toString', 42, null])
    assert.equal(isCardIconName(name), false, name)
  const kindLine = () => ({text: 'Rust crate component'})
  const plain = graphCardWidth(one(), {kindLine})
  assert.equal(graphCardWidth(one(), {kindLine, icon: () => 'terminal'}), Math.ceil((32 + cardIconRoom + 20 * 6.6) / 4) * 4)
  assert.ok(graphCardWidth(one(), {kindLine, icon: () => 'terminal'}) > plain)
  assert.equal(graphCardWidth(one(), {kindLine, icon: () => 'no-such-icon'}), plain)
  // Either revision's icon keeps the room, so the card never resizes while scrubbing.
  const row = {before: {id: 'a', kind: 'service', label: 'api'}, after: {id: 'a', kind: 'service', label: 'api', data: {icon: 'cpu'}}}
  const icon = entity => entity.data?.icon
  assert.equal(graphCardWidth(row, {kindLine, icon}), graphCardWidth(one(), {kindLine, icon: () => 'cpu'}))
  // In the diff, the kind line starts after the icon.
  const card = diffCardText({after: row.after, kind: {text: 'Service'}, icon: true})
  assert.equal(card.lines[0].x, 16 + cardIconRoom)
  assert.equal(diffCardText({after: row.after, kind: {text: 'Service'}}).lines[0].x, 16)
})

test('the graph renderer docs list exactly the card icons', () => {
  const docs = readFileSync(new URL('../../../../docs/builtins/renderers/graph.md', import.meta.url), 'utf8')
  const listed = /<!-- card-icons -->([\s\S]*?)<!-- end card-icons -->/.exec(docs)?.[1] ?? ''
  assert.deepEqual(
    [...listed.matchAll(/`([a-z0-9-]+)`/g)].map(match => match[1]),
    cardIconNames,
  )
})
