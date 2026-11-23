import assert from 'node:assert/strict'
import test from 'node:test'
import {check, findings, kitRenderer, read} from './check-change-hues.mjs'

test('a change hue is found in CSS and code, by alias or theme token; kit marks and other colors are not', () => {
  for (const line of [
    '  color: color-mix(in srgb, var(--red) calc(var(--emphasis) * 100%), var(--muted));',
    '  background: var(--green-soft);',
    '  stroke: var(--amber-border, #9a6700);',
    '  --added: var(--projections-color-added, #1a7f37);',
    "  const ink = tokenVar('color-removed')",
    "  const ink = token.color('added')",
    "  const tint = token.color('removed-highlight')",
    "  const red = getComputedStyle(root).getPropertyValue('--red')",
  ]) {
    assert.equal(findings(line).length, 1, line)
  }
  for (const line of [
    '  color: color-mix(in srgb, var(--pk-change-ink) calc(var(--emphasis) * 100%), var(--muted));',
    '  background: var(--pk-region-fill);',
    '  color: var(--accent);',
    '  border-color: var(--red-ish-custom);',
    '  fill: var(--projections-chart-3);',
    "  const accent = token.color('accent')",
    "  const ink = getComputedStyle(root).getPropertyValue('--pk-change-ink')",
  ]) {
    assert.deepEqual(findings(line), [], line)
  }
})

test('only renderers built on the kit are read, and only their source', () => {
  const kit = {dependencies: {'@githubnext/projections-renderer-kit': '0.2.0'}}
  assert.equal(kitRenderer('packages/renderers/database', kit), true)
  assert.equal(kitRenderer('packages/renderers/kit', kit), false)
  assert.equal(kitRenderer('examples/renderers/minimal', {dependencies: {'@githubnext/projections': '0.2.0'}}), false)
  assert.equal(read('src/styles.css'), true)
  assert.equal(read('src/view.tsx'), true)
  assert.equal(read('test/view.test.mjs'), false)
  assert.equal(read('browser/renderer.spec.ts'), false)
})

test('an exception needs a reason, excuses its file, and fails once stale', () => {
  const files = [['packages/renderers/a/src/styles.css', 'a { color: var(--green); }']]
  assert.equal(check(files, []).violations.length, 1)
  assert.throws(() => check(files, [{path: 'packages/renderers/a/src/styles.css'}]), /needs a path and a reason/u)
  const entry = {path: 'packages/renderers/a/src/styles.css', reason: 'Categorical: the legend keys a category by color.'}
  assert.deepEqual(check(files, [entry]), {violations: [], stale: []})
  assert.deepEqual(check([['packages/renderers/a/src/styles.css', 'a { color: var(--pk-change-ink); }']], [entry]).stale, [entry])
})
