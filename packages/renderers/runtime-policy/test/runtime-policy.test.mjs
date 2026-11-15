import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, extractionModel, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'
import {badgeIconNames} from '@githubnext/projections-renderer-sdk/protocol'
import {plainProse} from '@githubnext/projections-schemas'
import {buildModel} from '../node_modules/.cache/test/build.js'
import {chipPrefix, conditionLines, effectProse, warnings} from '../node_modules/.cache/test/prose.js'
import {findingLabels, interpretationIcons} from '../node_modules/.cache/test/model.js'

const plain = markup => markup.replace(/<[^>]+>/g, '')
import {RuntimePolicyView} from '../node_modules/.cache/test/view.js'

const engine = createNativeEngine()
const runtime = createRulesRuntime()
const rules = new Uint8Array(readFileSync(new URL('../../../comparators/runtime-policy/runtime-policy.comparator.yaml', import.meta.url)))
const fixture = name =>
  JSON.parse(readFileSync(new URL(`../../../extractors/tetragon-policies/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('credentials/before.expected.json')
const after = fixture('credentials/after.expected.json')
const library = fixture('library/expected.json')

async function interpreted(a = before, b = after) {
  // The runtime policy rules, run in the rules interpreter as hosts run them.
  return runtime.compare(rules, {protocolVersion: 0, before: a, after: b, baseline: {}, options: {}})
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
    onSelect() {},
    onOpen() {},
    reportSteps() {},
    controls: {},
    declareControls() {},
    onAction: () => () => {},
    reportLegend() {},
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
  ])
    assert.ok(effects.has(expected), `${expected} in ${[...effects]}`)
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
  for (const icon of [...Object.values(interpretationIcons), ...findingLabels.map(label => label.icon)])
    assert.ok(!badgeIconNames.includes(icon), icon)
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
  assert.match(single, /data-projections-identifier="">security_file_permission</)
  assert.match(single, /data-projections-identifier="">\/usr\/<wbr\/>bin\/<wbr\/>curl</)
  assert.match(single, /Kill \(<code class="pk-code" data-projections-identifier="">Sigkill<\/code>\)/)
  assert.match(single, /starts with <code class="pk-code" data-projections-identifier="">\/root\/<wbr\/>.ssh<\/code> or/)
  // Long code values wrap only after their separators, never inside a word.
  for (const code of single.match(/<code class="pk-code"[^>]*>.*?<\/code>/g))
    for (const [, before] of code.matchAll(/(.)<wbr\/>/g)) assert.match(before, /[/.\-=,:]/)
  assert.doesNotMatch(single, /class="rp-cell rp-status"/)
  assert.doesNotMatch(single, /class="rp-sign"/)

  const comparison = await interpreted()
  const init = {mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const diff = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(before, after, comparison), init)))
  // Status is a stack of icon-led lines with no separators, read as one sentence.
  assert.match(plain(diff), /Added, newly enforced/)
  assert.match(plain(diff), /Modified, scope broadened/)
  assert.match(plain(diff), /Removed, no longer covered/)
  assert.match(
    diff,
    /<span class="rp-interpretation"><span class="pk-icon rp-icon" data-icon="enforced" aria-hidden="true"><\/span>Newly enforced<\/span>/,
  )
  assert.doesNotMatch(diff, /rp-dot/)
  const statusLines = [
    ...diff.matchAll(/<span class="(?:pk-status-part [a-z]+|rp-interpretation)"[^>]*>((?:<span[^>]*><\/span>)?[^<]*)<\/span>/g),
  ].map(match => match[1])
  assert.ok(statusLines.length >= 6)
  assert.deepEqual(
    statusLines.filter(line => !line.startsWith('<span class="pk-icon rp-icon"') || /^\s*[·•|,;—–]/.test(plain(line))),
    [],
    'every status line is led by its icon, never by a separator',
  )
  // A lane whose rows inherit its removal shows no status heading; a lane with changed rows of its own does.
  const lane = id => diff.match(new RegExp(`<section[^>]*data-entity-id="${id}"[\\s\\S]*?</section>`))[0]
  assert.match(lane('hook:kprobe:security_mmap_file'), /<span style="opacity:0;visibility:hidden">Change<\/span>/)
  assert.match(lane('hook:kprobe:security_file_permission'), /<span style="opacity:1">Change<\/span>/)
  assert.doesNotMatch(plain(diff), /1 newly enforced/, "the host's summary bar counts the findings")
  assert.doesNotMatch(diff, /[▲⇱⚠]/, 'status is words, not glyphs')
  assert.match(
    diff,
    /class="rp-chip pk-part removed filled"[^>]*><span class="rp-chip-sign" aria-hidden="true">−<\/span><span class="sr-only">Removed: <\/span>/,
  )

  const quiet = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(comparisonModel(before, after, comparison), init, {highlighting: 0, emphasis: () => 0})),
  )
  // With highlighting off, the sign column also states the change for assistive technology.
  const content = markup =>
    markup
      .replace(/ style="[^"]*"/g, '')
      .replace(/ aria-hidden="(true|false)"/g, '')
      .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
  assert.equal(content(quiet), content(diff), 'highlighting changes only emphasis, never content')
})

test('a modified rule and policy show old and new values in place', async () => {
  const monitor = fixture('credentials/monitor.expected.json')
  const comparison = await interpreted(after, monitor)
  const init = {mode: 'comparison', before: after, after: monitor, comparison, comparisonMode: 'diff'}
  const markup = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(after, monitor, comparison), init)))
  assert.match(
    markup,
    /mode <del class="rp-old"><code class="pk-code" data-projections-identifier="">enforce<\/code><\/del>.*<ins class="rp-new"><code class="pk-code" data-projections-identifier="">monitor<\/code><\/ins>/,
  )
  assert.match(plain(markup), /Kill \(Sigkill\) →\s+now\s+Kill \(Sigkill\) \(elided in monitor mode\)/)
  assert.match(plain(markup), /Mode changed/)
  assert.match(plain(markup), /Enforcement elided/)
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
  assert.match(markup, /No runtime security policies/)
})

test('each section is a titled panel: a heading in the UI font, then one table, a category grouped by hook', () => {
  const markup = renderToStaticMarkup(
    createElement(RuntimePolicyView, props(extractionModel(library), {mode: 'extraction', extraction: library})),
  )
  // Each title follows its subject's icon, decorative since the title names it.
  const titles = [
    ...markup.matchAll(
      /<h2 class="pk-group-title" id="[^"]+"><span class="pk-group-icon"><span class="pk-icon" data-icon="([a-z]+)" aria-hidden="true"><\/span><\/span><span class="pk-group-label pk-truncate" title="([^"]+)">/g,
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
  assert.doesNotMatch(markup, /class="pk-group-label[^"]*" data-projections-identifier/)
  // Each panel is labelled by its heading and holds one table.
  const panels = [
    ...markup.matchAll(
      /<section class="pk-group rp-panel" aria-labelledby="([^"]+)"><header class="pk-group-header"><h2 class="pk-group-title" id="([^"]+)">.*?<\/header><(ul|div) class="rp-table (rp-list|rp-lanes)"/g,
    ),
  ]
  assert.equal(panels.length, 6)
  for (const [, labelled, heading] of panels) assert.equal(labelled, heading)
  // A category's hooks are lanes of its table, each headed by its hook, then the column headers of its rules.
  const credentials = markup.slice(markup.indexOf('title="Credentials"'), markup.indexOf('title="Network"'))
  const lanes = [
    ...credentials.matchAll(
      /<section class="rp-lane"[^>]*><div class="rp-row rp-hook">.*?<\/div><div class="rp-row rp-head" aria-hidden="true">(.*?)<\/div>/g,
    ),
  ]
  assert.equal(lanes.length, 2)
  for (const [, head] of lanes)
    assert.deepEqual(plain(head.replace(/></g, '> <')).split(' ').filter(Boolean), ['Rule', 'Effect', 'Applies', 'to'])
})

test('in the diff, changed rows marked the same way join into one change run, as text diff marks lines', async () => {
  const [a, b] = ['before', 'after'].map(name => fixture(`deployment/${name}.expected.json`))
  const comparison = await interpreted(a, b)
  const init = {mode: 'comparison', before: a, after: b, comparison, comparisonMode: 'diff'}
  const markup = renderToStaticMarkup(createElement(RuntimePolicyView, props(comparisonModel(a, b, comparison), init)))
  const row = id => markup.match(new RegExp(`<li class="rp-row rp-policy[^"]*"[^>]*data-entity-id="policy:[^"]*:${id}"[^>]*>`))[0]
  // Two modified policies in a row are one run: edged above the first and below the last.
  assert.match(row('egress-audit'), /class="rp-row rp-policy pk-region pk-region-run"[^>]*data-change="modified" data-run-start=""/)
  assert.doesNotMatch(row('egress-audit'), /data-run-end/)
  assert.match(row('protect-credentials'), /data-change="modified" data-run-end=""/)
  assert.doesNotMatch(row('protect-credentials'), /data-run-start/)
  // An added policy after them starts a run of its own.
  assert.match(row('shell-guard'), /data-change="added" data-run-start="" data-run-end=""/)
  // An added hook marks its whole lane, once.
  assert.match(
    markup,
    /<section class="rp-lane pk-region pk-region-run"[^>]*data-entity-id="hook:kprobe:sys_execve"[^>]*data-change="added" data-run-start="" data-run-end=""/,
  )
})
