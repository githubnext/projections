import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {changesScope, comparisonModel, extractionModel, scopedModel, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'
import {badgeIconNames} from '@githubnext/projections-renderer-sdk/protocol'
import {plainProse} from '@githubnext/projections-schemas'
import {buildModel} from '../node_modules/.cache/test/build.js'
import {chipPrefix, conditionLines, effectProse, warnings} from '../node_modules/.cache/test/prose.js'
import {findingLabels, interpretationIcons} from '../node_modules/.cache/test/model.js'

import {RuntimePolicyView} from '../node_modules/.cache/test/view.js'
import {runtimePolicyContext} from '../node_modules/.cache/test/scope.js'
import {plain} from '../../kit/test/markup.mjs'

const noop = () => undefined
const runtime = createRulesRuntime()
const comparatorRules = new Uint8Array(
  readFileSync(new URL('../../../comparators/runtime-policy/runtime-policy.comparator.yaml', import.meta.url)),
)
const fixture = name =>
  JSON.parse(readFileSync(new URL(`../../../extractors/tetragon-policies/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('credentials/before.expected.json')
const after = fixture('credentials/after.expected.json')
const library = fixture('library/expected.json')

async function interpreted(a = before, b = after) {
  // The runtime policy rules, run in the rules interpreter as hosts run them.
  return runtime.compare(comparatorRules, {protocolVersion: 0, before: a, after: b, baseline: {}, options: {}})
}

function props(model, init, overrides = {}) {
  const schedule = []
  return {
    init,
    model,
    comparing: init.mode === 'comparison',
    diff: init.mode === 'comparison' && init.comparisonMode === 'diff',
    comparisonMode: init.comparisonMode,
    progress: 1,
    highlighting: init.mode === 'comparison' ? 1 : 0,
    emphasis: stepEmphasis(schedule, 1, init.mode === 'comparison' ? 1 : 0),
    direction: 1,
    schedule,
    rendererName: 'runtime-policy',
    selectedId: null,
    hoveredId: null,
    onSelect: noop,
    onOpen: noop,
    reportSteps: noop,
    controls: {},
    declareControls: noop,
    onAction: () => noop,
    reportLegend: noop,
    options: {},
    viewport: undefined,
    reducedMotion: false,
    locale: 'en',
    ...overrides,
  }
}

test('a single revision is a coverage map: hooks by category, each with its policies and rules', () => {
  const view = buildModel(extractionModel(library), 'after')
  assert.deepEqual(
    view.categories.map(category => [category.id, category.hooks.map(hook => hook.entity.label)]),
    [
      ['credentials', ['sys_setreuid', 'sys_setuid']],
      ['network', ['tcp_connect']],
      ['kernel-modules', ['do_init_module', 'kernel_module_request', 'module/module_load']],
      ['user-space', ['/bin/bash:readline', 'ssl:handshake']],
      ['other', ['generated:generated_syscalls']],
    ],
  )
  assert.deepEqual(view.counts.policies, {now: 5, was: 5})
  assert.equal(view.interpreted, false)
  const setuid = view.categories[0].hooks[1].probes[0]
  assert.equal(setuid.policy.entity.label, 'setuid-root')
  assert.deepEqual(conditionLines(setuid.selectors[0].entity), ['`uid` = `0`'])
})

test('effects and subjects read as words', () => {
  const view = buildModel(extractionModel(library), 'after')
  const rules = view.categories.flatMap(category => category.hooks.flatMap(hook => hook.probes.flatMap(probe => probe.selectors)))
  const effects = new Set(rules.map(rule => plainProse(effectProse(rule.entity))))
  for (const expected of [
    'Observe',
    'Deny (Override returns -1) (elided in monitor mode)',
    'Kill (Sigkill) (elided in monitor mode)',
    'Teleport',
    'Suppress event (NoPost), Track socket (TrackSock)',
  ]) {
    assert.ok(effects.has(expected), `${expected} in ${[...effects]}`)
  }
  const kmod = rules.flatMap(rule => rule.chips).find(chip => chip.subject.entity.label === '/usr/bin/kmod')
  assert.equal(chipPrefix(kmod), 'except')
  const parent = rules.flatMap(rule => rule.chips).find(chip => chip.subject.entity.label === '/usr/local/bin/')
  assert.equal(chipPrefix(parent), 'launched by binaries under')
})

test('the diff places every rule once, with old and new scope as chips and the comparator interpretations', async () => {
  const comparison = await interpreted()
  const model = comparisonModel(before, after, comparison)
  const view = buildModel(model, 'diff', comparison.metadata)
  assert.equal(view.interpreted, true)
  assert.deepEqual(view.counts.enforcing, {now: 1, was: 0})
  assert.deepEqual(view.counts.hooks, {now: 2, was: 3})
  assert.equal(view.findings.get('newly-enforced'), 1)
  const policy = view.policies.find(item => item.entity.label === 'protect-credentials')
  assert.deepEqual(policy.interpretations, ['scope-broadened'])
  assert.deepEqual(
    policy.scope.map(chip => [chip.change, chip.subject.entity.label]),
    [
      ['removed', 'pods where app.kubernetes.io/part-of=payments'],
      ['added', 'pods where app.kubernetes.io/part-of in (checkout, payments)'],
    ],
  )
  const file = view.categories.find(category => category.id === 'file')
  assert.deepEqual(
    file.hooks.map(hook => [hook.entity.label, hook.row.status, hook.interpretations]),
    [
      ['security_file_permission', 'unchanged', []],
      ['security_mmap_file', 'removed', ['coverage-lost']],
    ],
  )
  const rules = file.hooks[0].probes[0].selectors
  assert.deepEqual(
    rules.map(rule => [rule.entity.label, rule.row.status, rule.chips.map(chip => `${chip.change} ${chip.subject.entity.label}`)]),
    [
      ['ssh-keys-read', 'unchanged', []],
      ['token-read-by-downloader', 'added', ['added /usr/bin/curl', 'added /usr/bin/wget']],
    ],
  )
})

test("the comparator's interpretations are notes after a change's status: outline icons, never badges", () => {
  for (const icon of [...Object.values(interpretationIcons), ...findingLabels.map(label => label.icon)]) {
    assert.ok(!badgeIconNames.includes(icon), icon)
  }
  assert.equal(interpretationIcons['scope-changed'], 'rescoped')
  assert.equal(interpretationIcons['nodes-changed'], 'rescoped')
})

test('side-by-side panes each draw one revision', async () => {
  const comparison = await interpreted()
  const model = comparisonModel(before, after, comparison)
  const left = buildModel(model, 'before', comparison.metadata)
  const right = buildModel(model, 'after', comparison.metadata)
  const hooks = view => view.categories.flatMap(category => category.hooks.map(hook => hook.entity.label))
  assert.deepEqual(hooks(left), ['security_file_permission', 'security_mmap_file', 'tcp_connect'])
  assert.deepEqual(hooks(right), ['security_file_permission', 'tcp_connect'])
  assert.deepEqual(
    left.policies.find(item => item.entity.label === 'protect-credentials').scope.map(chip => chip.subject.entity.label),
    ['pods where app.kubernetes.io/part-of=payments'],
  )
})

test('markup: identifiers are marked, effects are words, and status footers are reserved only in comparisons', async () => {
  const single = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(extractionModel(after), {mode: 'extraction', extraction: after})),
  )
  assert.match(single, /data-projections-identifier="">security_file_permission</u)
  assert.match(single, /data-projections-identifier="">\/usr\/<wbr\/>bin\/<wbr\/>curl</u)
  assert.match(single, /Kill \(<code class="pk-code" data-projections-identifier="">Sigkill<\/code>\)/u)
  assert.match(single, /starts with <code class="pk-code" data-projections-identifier="">\/root\/<wbr\/>.ssh<\/code> or/u)
  // Long code values wrap only after their separators, never inside a word.
  for (const code of single.match(/<code class="pk-code"[^>]*>.*?<\/code>/gu)) {
    for (const [, preceding] of code.matchAll(/(.)<wbr\/>/gu)) assert.match(preceding, /[/.\-=,:]/u)
  }
  assert.doesNotMatch(single, /class="rp-cell rp-status"/u)
  assert.doesNotMatch(single, /class="rp-sign"/u)

  const comparison = await interpreted()
  const init = {mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const diff = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(before, after, comparison), init)))
  // Status is a stack of icon-led lines with no separators, read as one sentence.
  assert.match(plain(diff), /Added, newly enforced/u)
  assert.match(plain(diff), /Modified, scope broadened/u)
  assert.match(plain(diff), /Removed, no longer covered/u)
  assert.match(
    diff,
    /<span class="rp-interpretation"><span class="pk-icon rp-icon" data-icon="enforced" aria-hidden="true"><\/span>Newly enforced<\/span>/u,
  )
  assert.doesNotMatch(diff, /rp-dot/u)
  const statusLines = [
    ...diff.matchAll(/<span class="(?:pk-status-part [a-z]+|rp-interpretation)"[^>]*>((?:<span[^>]*><\/span>)?[^<]*)<\/span>/gu),
  ].map(match => match[1])
  assert.ok(statusLines.length >= 6)
  assert.deepEqual(
    statusLines.filter(line => !line.startsWith('<span class="pk-icon rp-icon"') || /^\s*[·•|,;—–]/u.test(plain(line))),
    [],
    'every status line is led by its icon, never by a separator',
  )
  // A lane whose rows inherit its removal shows no status heading; a lane with changed rows of its own does.
  const lane = id => diff.match(new RegExp(`<section[^>]*data-entity-id="${id}"[\\s\\S]*?</section>`))[0]
  assert.match(lane('hook:kprobe:security_mmap_file'), /<span style="opacity:0;visibility:hidden">Change<\/span>/u)
  assert.match(lane('hook:kprobe:security_file_permission'), /<span style="opacity:1">Change<\/span>/u)
  assert.doesNotMatch(plain(diff), /1 newly enforced/u, "the host's summary bar counts the findings")
  assert.doesNotMatch(diff, /[▲⇱⚠]/u, 'status is words, not glyphs')
  assert.match(
    diff,
    /class="rp-chip pk-part removed filled"[^>]*><span class="rp-chip-sign pk-label" aria-hidden="true">−<\/span><span class="sr-only">Removed: <\/span>/u,
  )

  const quiet = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(comparisonModel(before, after, comparison), init, {highlighting: 0, emphasis: () => 0})),
  )
  // With highlighting off, the sign column also states the change for assistive technology.
  const content = markup =>
    markup
      .replaceAll(/ style="[^"]*"/gu, '')
      .replaceAll(/ aria-hidden="(true|false)"/gu, '')
      .replaceAll(/<span class="sr-only">[^<]*<\/span>/gu, '')
  assert.equal(content(quiet), content(diff), 'highlighting changes only emphasis, never content')
})

test('a modified rule and policy show old and new values in place', async () => {
  const monitor = fixture('credentials/monitor.expected.json')
  const comparison = await interpreted(after, monitor)
  const init = {mode: 'comparison', before: after, after: monitor, comparison, comparisonMode: 'diff'}
  const markup = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(after, monitor, comparison), init)))
  assert.match(
    markup,
    /mode <del class="rp-old" data-change="removed"><code class="pk-code" data-projections-identifier="">enforce<\/code><\/del>.*<ins class="rp-new" data-change="added"><code class="pk-code" data-projections-identifier="">monitor<\/code><\/ins>/u,
  )
  assert.match(plain(markup), /Kill \(Sigkill\) →\s+now\s+Kill \(Sigkill\) \(elided in monitor mode\)/u)
  assert.match(plain(markup), /Mode changed/u)
  assert.match(plain(markup), /Enforcement elided/u)
})

test('deployment facts: agent, kernels and workloads with the policies covering them', async () => {
  const [a, b] = ['before', 'after'].map(name => fixture(`deployment/${name}.expected.json`))
  const comparison = await interpreted(a, b)
  const view = buildModel(comparisonModel(a, b, comparison), 'diff', comparison.metadata)
  assert.deepEqual(
    view.deployment.map(item => [item.entity.kind, item.entity.label]),
    [
      ['agent', 'Tetragon agent'],
      ['kernel', 'general'],
      ['kernel', 'legacy'],
    ],
  )
  assert.deepEqual(
    view.workloads.map(item => [item.entity.label, item.coveredBy.map(chip => `${chip.change} ${chip.subject.entity.label}`)]),
    [
      ['checkout-web', ['unchanged egress-audit', 'added protect-credentials']],
      ['payments-api', ['unchanged protect-credentials', 'added shell-guard']],
      ['settlement', ['unchanged protect-credentials', 'added shell-guard']],
    ],
  )
  const tcp = view.categories.find(category => category.id === 'network').hooks[0]
  assert.deepEqual(warnings(tcp.entity), ['Unavailable on `general`: `tcp_connect` is not a kernel symbol there.'])
})

test('an empty revision says so', () => {
  const empty = {protocolVersion: 0, schema: 'architecture/v0', entities: [], relationships: []}
  const markup = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(extractionModel(empty), {mode: 'extraction', extraction: empty})),
  )
  assert.match(markup, /No runtime security policies/u)
})

test('each section is a titled panel: a heading in the UI font, then one table, a category grouped by hook', () => {
  const markup = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(extractionModel(library), {mode: 'extraction', extraction: library})),
  )
  // Each title follows its subject's icon, decorative since the title names it.
  const titles = [
    ...markup.matchAll(
      /<h2 class="pk-group-title" id="[^"]+"><span class="pk-group-icon"><span class="pk-icon" data-icon="([a-z]+)" aria-hidden="true"><\/span><\/span><span class="pk-group-label pk-label pk-truncate" title="([^"]+)">/gu,
    ),
  ]
  assert.deepEqual(
    titles.map(match => [match[2], match[1]]),
    [
      ['Policies', 'policy'],
      ['Credentials', 'credential'],
      ['Network', 'network'],
      ['Kernel modules', 'module'],
      ['User space', 'application'],
      ['Other', 'other'],
    ],
  )
  // Section titles are words, never code: only the rows' names are identifiers.
  assert.doesNotMatch(markup, /class="pk-group-label[^"]*" data-projections-identifier/u)
  // Each panel is labelled by its heading and holds one table.
  const panels = [
    ...markup.matchAll(
      /<section class="pk-group rp-panel" aria-labelledby="([^"]+)"><header class="pk-group-header"><h2 class="pk-group-title" id="([^"]+)">.*?<\/header><(ul|div) class="rp-table (rp-list|rp-lanes)"/gu,
    ),
  ]
  assert.equal(panels.length, 6)
  for (const [, labelled, heading] of panels) assert.equal(labelled, heading)
  // A category's hooks are lanes of its table, each headed by its hook, then the column headers of its rules.
  const credentials = markup.slice(markup.indexOf('title="Credentials"'), markup.indexOf('title="Network"'))
  const lanes = [
    ...credentials.matchAll(
      /<section class="rp-lane"[^>]*><div class="rp-row rp-hook">.*?<\/div><div class="rp-row rp-head" aria-hidden="true">(.*?)<\/div>/gu,
    ),
  ]
  assert.equal(lanes.length, 2)
  for (const [, head] of lanes) {
    assert.deepEqual(plain(head.replaceAll('><', '> <')).split(' ').filter(Boolean), ['Rule', 'Effect', 'Applies', 'to'])
  }
})

test('in the diff, changed rows marked the same way join into one change run, as text diff marks lines', async () => {
  const [a, b] = ['before', 'after'].map(name => fixture(`deployment/${name}.expected.json`))
  const comparison = await interpreted(a, b)
  const init = {mode: 'comparison', before: a, after: b, comparison, comparisonMode: 'diff'}
  const markup = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(a, b, comparison), init)))
  const row = id => markup.match(new RegExp(`<li class="rp-row rp-policy[^"]*"[^>]*data-entity-id="policy:[^"]*:${id}"[^>]*>`))[0]
  // Two modified policies in a row are one run: edged above the first and below the last.
  assert.match(row('egress-audit'), /class="rp-row rp-policy pk-region pk-region-run"[^>]*data-change="modified" data-run-start=""/u)
  assert.doesNotMatch(row('egress-audit'), /data-run-end/u)
  assert.match(row('protect-credentials'), /data-change="modified" data-run-end=""/u)
  assert.doesNotMatch(row('protect-credentials'), /data-run-start/u)
  // An added policy after them starts a run of its own.
  assert.match(row('shell-guard'), /data-change="added" data-run-start="" data-run-end=""/u)
  // An added hook marks its whole lane, once.
  assert.match(
    markup,
    /<section class="rp-lane pk-region pk-region-run"[^>]*data-entity-id="hook:kprobe:sys_execve"[^>]*data-change="added" data-run-start="" data-run-end=""/u,
  )
})

/** The diff in the Changes scope, as the shell narrows it: the changes, their context, each laid out whole. */
function changesView(model, metadata) {
  const scope = changesScope(model, {query: '', changesOnly: true, ids: null})
  const shown = new Set([...scope.shown, ...runtimePolicyContext(model, scope.changes)])
  return buildModel(scopedModel(model, shown, 'whole').model, 'diff', metadata)
}

const chipNames = items =>
  Object.fromEntries(items.map(item => [item.entity.label, (item.scope ?? item.coveredBy).map(chip => chip.subject.entity.label)]))

test("the Changes scope keeps what a changed policy's chips name, so an unchanged Applies to still reads", async () => {
  // Only a rule changes: the policy's scope is the same in both revisions.
  const edited = structuredClone(before)
  const rule = edited.entities.find(entity => entity.kind === 'selector')
  rule.data = {...rule.data, matchArgs: [{index: 0, operator: 'Prefix', values: ['/var/run/secrets/']}]}
  const comparison = await interpreted(before, edited)
  const model = comparisonModel(before, edited, comparison)
  const full = changesView(model, comparison.metadata)
  const all = buildModel(model, 'diff', comparison.metadata)
  assert.ok(full.policies.length > 0)
  const shown = chipNames(full.policies)
  assert.deepEqual(shown, Object.fromEntries(Object.keys(shown).map(label => [label, chipNames(all.policies)[label]])))
  assert.ok(
    Object.values(shown).every(names => names.length > 0),
    'no policy reads as applying to no workloads',
  )
})

test('the Changes scope keeps the policies covering a changed workload', async () => {
  // Only a covered workload changes: the policies covering it don't.
  const a = fixture('deployment/before.expected.json')
  const b = structuredClone(a)
  const covered = new Set(b.relationships.filter(relationship => relationship.kind === 'covers').map(relationship => relationship.to))
  const workload = b.entities.find(entity => entity.kind === 'workload' && covered.has(entity.id))
  workload.data = {...workload.data, replicas: 7}
  const comparison = await interpreted(a, b)
  const model = comparisonModel(a, b, comparison)
  const scoped = chipNames(changesView(model, comparison.metadata).workloads)
  const all = chipNames(buildModel(model, 'diff', comparison.metadata).workloads)
  assert.deepEqual(Object.keys(scoped), [workload.label])
  assert.deepEqual(scoped[workload.label], all[workload.label])
  assert.ok(scoped[workload.label].length > 0, 'the workload reads as covered')
})

test("the Changes scope keeps a changed rule's matched and excluded subjects, so its binaries still read", async () => {
  // Two rules change their conditions only: one matches binaries under a prefix, one excludes a binary.
  const edited = structuredClone(library)
  const ruled = new Set(edited.relationships.filter(item => ['matches', 'excludes'].includes(item.kind)).map(item => item.from))
  assert.equal(ruled.size, 2)
  for (const rule of edited.entities.filter(entity => ruled.has(entity.id))) {
    rule.data = {
      ...rule.data,
      conditions: [
        ...(rule.data.conditions ?? []),
        {display: '`arg1` (`int`) = `4`', filter: 'matchArgs', index: 1, operator: 'Equal', values: ['4']},
      ],
    }
  }
  const comparison = await interpreted(library, edited)
  const model = comparisonModel(library, edited, comparison)
  const rules = view =>
    new Map(
      view.categories.flatMap(category =>
        category.hooks.flatMap(hook =>
          hook.probes.flatMap(probe =>
            probe.selectors.map(rule => [rule.row.id, rule.chips.map(chip => [chip.kind, chip.subject.entity.label])]),
          ),
        ),
      ),
    )
  const scoped = rules(changesView(model, comparison.metadata))
  const all = rules(buildModel(model, 'diff', comparison.metadata))
  const changed = [...ruled].map(id => model.entityRow.after.get(id))
  for (const id of changed) {
    assert.ok(scoped.get(id)?.length, `${id} shows its binaries`)
    assert.deepEqual(scoped.get(id), all.get(id), id)
  }
  assert.deepEqual(new Set(changed.flatMap(id => scoped.get(id).map(([kind]) => kind))), new Set(['matches', 'excludes']))
})
