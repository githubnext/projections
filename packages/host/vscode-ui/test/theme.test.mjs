import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {themeTokenNames} from '@githubnext/projections-renderer-sdk/protocol'
import {isHighContrast, vscodeThemeKindOf} from '../dist/theme/kinds.js'
import {vscodeThemeTokens} from '../dist/theme/tokens.js'
import {vscodeTokenMap} from '../dist/theme/variables.js'
import {composite, contrast, formatColor, parseColor} from '@githubnext/projections-host'

const directory = new URL('../fixtures/themes/', import.meta.url)
const fixtures = readdirSync(directory)
  .filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(new URL(name, directory), 'utf8')))
const surfaces = ['color-surface-canvas', 'color-surface-raised', 'color-surface-header', 'color-surface-inset']
const hues = ['added', 'removed', 'modified', 'moved']

function color(tokens, name) {
  const parsed = parseColor(tokens[name])
  assert.ok(parsed, `${name} is a color: ${tokens[name]}`)
  return parsed
}
/** A variable's value in the token's form (`#rrggbb`, or `#rrggbbaa` when translucent). */
const same = value => formatColor(parseColor(value))

test('the fixtures are the representative VS Code themes, captured with their body classes and variables', () => {
  assert.deepEqual(fixtures.map(fixture => fixture.id).sort(), [
    'dark-2026',
    'dark-high-contrast',
    'dark-modern',
    'light-high-contrast',
    'light-modern',
    'solarized-dark',
  ])
  for (const fixture of fixtures) {
    assert.ok(vscodeThemeKindOf(fixture.bodyClasses), `${fixture.id} has a theme kind`)
    assert.ok(Object.keys(fixture.variables).length > 500, `${fixture.id} has VS Code's variables`)
    for (const name of ['--vscode-editor-background', '--vscode-foreground', '--vscode-focusBorder', '--vscode-font-family']) {
      assert.ok(fixture.variables[name], `${fixture.id} sets ${name}`)
    }
  }
  const mapped = new Set(Object.values(vscodeTokenMap).flat())
  for (const name of [
    '--vscode-gitDecoration-addedResourceForeground',
    '--vscode-gitDecoration-deletedResourceForeground',
    '--vscode-gitDecoration-modifiedResourceForeground',
    '--vscode-diffEditor-insertedLineBackground',
    '--vscode-diffEditor-removedLineBackground',
    '--vscode-focusBorder',
    '--vscode-editor-font-family',
  ]) {
    assert.ok(mapped.has(name), `the mapping reads ${name}`)
  }
})

for (const fixture of fixtures) {
  const kind = vscodeThemeKindOf(fixture.bodyClasses)
  const hc = isHighContrast(kind)
  const tokens = vscodeThemeTokens(fixture.variables, kind)
  const v = fixture.variables

  test(`${fixture.name}: every renderer token is defined, resolved and short enough for the protocol`, () => {
    assert.deepEqual(Object.keys(tokens).sort(), [...themeTokenNames].sort())
    for (const [name, value] of Object.entries(tokens)) {
      assert.equal(typeof value, 'string', name)
      if (!name.startsWith('icon-')) assert.ok(value.length <= 512, `${name} is short enough`)
      assert.ok(!value.includes('var('), `${name} is resolved`)
    }
    for (const name of themeTokenNames.filter(name => name.startsWith('color-'))) color(tokens, name)
  })

  test(`${fixture.name}: the theme's own colors and fonts drive the tokens where they have the contrast`, () => {
    assert.equal(tokens['color-bg'], same(v['--vscode-editor-background']))
    const foreground = v['--vscode-editor-foreground'] ?? v['--vscode-foreground']
    if (surfaces.every(name => contrast(parseColor(foreground), color(tokens, name)) >= (hc ? 7 : 4.5))) {
      assert.equal(tokens['color-fg'], same(foreground))
    }
    assert.equal(tokens['font-family'], v['--vscode-font-family'].trim().replaceAll(/\s+/g, ' '))
    assert.equal(tokens['font-family-mono'], v['--vscode-editor-font-family'].trim().replaceAll(/\s+/g, ' '))
    for (const [hue, variable] of [
      ['added', '--vscode-gitDecoration-addedResourceForeground'],
      ['removed', '--vscode-gitDecoration-deletedResourceForeground'],
      ['modified', '--vscode-gitDecoration-modifiedResourceForeground'],
    ]) {
      const own = parseColor(v[variable])
      if (surfaces.every(name => contrast(own, color(tokens, name)) >= 4.5)) assert.equal(tokens[`color-${hue}`], same(v[variable]), hue)
    }
    const focus = composite(parseColor(v['--vscode-focusBorder']), color(tokens, 'color-bg'))
    if (['color-bg', 'color-surface-raised'].every(name => contrast(focus, color(tokens, name)) >= 3)) {
      assert.equal(tokens['color-focus'], formatColor(focus))
    }
  })

  test(`${fixture.name}: text, edges and fills keep their contrast${hc ? ' (high contrast: 7:1 text)' : ''}`, () => {
    const fg = color(tokens, 'color-fg')
    const text = hc ? 7 : 4.5
    for (const surface of ['color-bg', 'color-surface-raised']) {
      assert.ok(contrast(fg, color(tokens, surface)) >= text, `color-fg on ${surface}`)
      assert.ok(contrast(color(tokens, 'color-fg-muted'), color(tokens, surface)) >= text, `color-fg-muted on ${surface}`)
      assert.ok(contrast(color(tokens, 'color-accent'), color(tokens, surface)) >= 4.5, `color-accent on ${surface}`)
      assert.ok(contrast(color(tokens, 'color-focus'), color(tokens, surface)) >= 3, `color-focus on ${surface}`)
    }
    for (const surface of surfaces) {
      assert.ok(contrast(color(tokens, 'color-divider'), color(tokens, surface)) >= 3, `color-divider on ${surface}`)
      for (const hue of hues) {
        assert.ok(contrast(color(tokens, `color-${hue}`), color(tokens, surface)) >= 4.5, `color-${hue} on ${surface}`)
        assert.ok(contrast(color(tokens, `color-${hue}-border`), color(tokens, surface)) >= 3, `color-${hue}-border on ${surface}`)
      }
    }
    for (const hue of hues) {
      for (const fill of [`color-${hue}-muted`, `color-${hue}-highlight`]) {
        assert.ok(contrast(fg, composite(color(tokens, fill), color(tokens, 'color-surface-raised'))) >= text, `text on ${fill}`)
      }
    }
    if (hc) assert.match(tokens['shadow-md'], /#00000000$/, 'high contrast draws no shadows')
  })
}
