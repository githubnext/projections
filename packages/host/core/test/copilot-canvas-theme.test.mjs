import {test} from 'node:test'
import assert from 'node:assert/strict'
import {optionalThemeTokenNames} from '@githubnext/projections-renderer-sdk/protocol'
import {
  composite,
  contrast,
  copilotCanvasThemeTokens,
  defaultThemeTokens,
  hostChromeVariables,
  hostTheme,
  parseColor,
  rendererLimits,
  themeTokenNames,
} from '../dist/index.js'

/** The app's canvas variables, as it mirrors them onto a canvas document in each mode. */
const app = {
  dark: {
    '--background-color-default': '#14161c',
    '--border-color-default': '#2d3340',
    '--text-color-default': '#e6e8ee',
    '--text-color-muted': '#8b93a6',
    '--color-focus-outline': '#4c8dff',
    '--true-color-blue': '#4493f8',
    '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  light: {
    '--background-color-default': '#f6f8fa',
    '--border-color-default': '#d1d9e0',
    '--text-color-default': '#1f2328',
    '--text-color-muted': '#59636e',
    '--color-focus-outline': '#0969da',
    '--true-color-blue': '#0969da',
    '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
  },
}
const surfaces = ['color-surface-canvas', 'color-surface-raised', 'color-surface-header', 'color-surface-inset']
const hues = ['added', 'removed', 'modified', 'moved']

for (const colorMode of ['dark', 'light']) {
  const tokens = copilotCanvasThemeTokens(app[colorMode], colorMode)
  const theme = hostTheme(colorMode, tokens).tokens
  const color = name => parseColor(theme[name])
  const ratio = (a, b) => contrast(color(a), color(b))

  test(`${colorMode}: the stage, text, rules, accent, focus and families are the app's`, () => {
    const v = app[colorMode]
    assert.equal(tokens['color-surface-canvas'], v['--background-color-default'])
    assert.equal(tokens['color-bg'], v['--background-color-default'])
    assert.equal(tokens['color-fg'], v['--text-color-default'])
    // Muted text is the app's, darkened (or lightened) only as far as a header band needs for 4.5:1.
    const [muted, appMuted] = [parseColor(tokens['color-fg-muted']), parseColor(v['--text-color-muted'])]
    for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(muted[channel] - appMuted[channel]) <= 8, `muted ${channel}`)
    assert.equal(tokens['color-border'], v['--border-color-default'])
    assert.equal(tokens['color-accent'], v['--color-focus-outline'])
    assert.equal(tokens['color-focus'], v['--color-focus-outline'])
    assert.equal(tokens['font-family'], v['--font-sans'])
    assert.equal(tokens['font-family-mono'], v['--font-mono'])
  })

  test(`${colorMode}: overrides are known tokens the protocol accepts, and keep the token set's contrast`, () => {
    for (const [name, value] of Object.entries(tokens)) {
      assert.ok(themeTokenNames.includes(name) || optionalThemeTokenNames.includes(name), name)
      assert.ok(value.length <= rendererLimits.tokenLength, name)
      if (name.startsWith('color-') || name.startsWith('chart-')) assert.ok(parseColor(value), `${name} is a color: ${value}`)
    }
    // Stacked surfaces are visibly distinct steps; cards above the stage.
    assert.ok(ratio('color-surface-raised', 'color-surface-canvas') >= 1.06)
    assert.ok(ratio('color-surface-header', 'color-surface-raised') >= 1.06)
    for (const surface of surfaces) {
      assert.ok(ratio('color-fg', surface) >= 4.5, `fg on ${surface}`)
      assert.ok(ratio('color-fg-muted', surface) >= 4.5, `fg-muted on ${surface}`)
      assert.ok(ratio('color-fg-subtle', surface) >= 3, `fg-subtle on ${surface}`)
      // Rules are the app's own divider, as its panes draw them; lines that carry meaning keep 3:1.
      assert.ok(ratio('color-connector', surface) >= 3, `connector on ${surface}`)
    }
    for (const surface of ['color-surface-canvas', 'color-surface-raised']) {
      assert.ok(ratio('color-accent', surface) >= 4.5, `accent on ${surface}`)
      assert.ok(ratio('color-focus', surface) >= 3, `focus on ${surface}`)
      for (const hue of hues) {
        assert.ok(ratio(`color-${hue}`, surface) >= 4.5, `${hue} on ${surface}`)
        assert.ok(ratio(`color-${hue}-border`, surface) >= 3, `${hue} edge on ${surface}`)
      }
    }
    // Fills behind plain text keep it readable on a card.
    const raised = color('color-surface-raised')
    for (const fill of ['color-highlight', 'color-accent-muted', ...hues.flatMap(hue => [`color-${hue}-muted`, `color-${hue}-highlight`])])
      assert.ok(contrast(color('color-fg'), composite(color(fill), raised)) >= 4.5, `fg on ${fill}`)
    assert.ok(ratio('color-fg-on-emphasis', 'color-accent-emphasis') >= 4.5)
    for (let index = 1; index <= 16; index++) assert.ok(ratio(`chart-${index}`, 'color-bg') >= 3, `chart-${index}`)
  })

  test(`${colorMode}: change colors and the categorical palette stay the token set's unless contrast needs them moved`, () => {
    const defaults = defaultThemeTokens(colorMode)
    for (const name of themeTokenNames.filter(name => /^color-(added|removed|modified|moved)|^chart-/.test(name))) {
      if (!(name in tokens)) continue
      // Moved only toward white (or black), which keeps the hue: never another color.
      const [before, after] = [parseColor(defaults[name]), parseColor(tokens[name])]
      const toward = colorMode === 'dark' ? 255 : 0
      for (const channel of ['r', 'g', 'b'])
        assert.ok(Math.abs(after[channel] - toward) <= Math.abs(before[channel] - toward) + 1, `${name} keeps its hue`)
    }
  })
}

test('without the app theme there are no overrides; unparseable or unsafe values keep their defaults', () => {
  assert.deepEqual(copilotCanvasThemeTokens({}, 'dark'), {})
  assert.deepEqual(copilotCanvasThemeTokens({'--background-color-default': 'not a color'}, 'dark'), {})
  const tokens = copilotCanvasThemeTokens(
    {
      '--background-color-default': '#14161c',
      '--text-color-default': 'var(--elsewhere)',
      '--text-color-muted': 'oklch(0.7 0.02 260)',
      '--color-focus-outline': '',
      '--font-sans': 'x; } body { display: none',
      '--font-mono': `url(${'a'.repeat(600)})`,
    },
    'dark',
  )
  const defaults = defaultThemeTokens('dark')
  assert.equal(tokens['color-fg'], defaults['color-fg'])
  assert.equal(tokens['color-fg-muted'], defaults['color-fg-muted'])
  assert.equal(tokens['color-accent'], defaults['color-accent'])
  assert.equal(tokens['font-family'], undefined)
  assert.equal(tokens['font-family-mono'], undefined)
})

test('a low-contrast app color is moved just far enough, never dropped', () => {
  const tokens = copilotCanvasThemeTokens(
    {'--background-color-default': '#14161c', '--text-color-default': '#30333a', '--text-color-muted': '#24262c'},
    'dark',
  )
  const bg = parseColor('#14161c')
  assert.ok(contrast(parseColor(tokens['color-fg']), bg) >= 4.5)
  assert.ok(contrast(parseColor(tokens['color-fg-muted']), bg) >= 4.5)
})

test("the chrome takes the stage's colors: every variable is a token's value, change colors only where moved", () => {
  for (const mode of ['dark', 'light']) {
    const tokens = copilotCanvasThemeTokens(app[mode], mode)
    const chrome = hostChromeVariables(tokens, mode)
    assert.equal(chrome['--pj-background'], tokens['color-surface-canvas'])
    assert.equal(chrome['--pj-surface-header'], tokens['color-surface-header'])
    assert.equal(chrome['--pj-card'], tokens['color-surface-raised'])
    assert.equal(chrome['--pj-muted'], tokens['color-surface-inset'])
    assert.equal(chrome['--pj-ring'], tokens['color-focus'])
    assert.equal(chrome['--pj-font-family'], tokens['font-family'])
    for (const [name, value] of Object.entries(chrome))
      if (!name.startsWith('--pj-font')) assert.ok(parseColor(value), `${mode} ${name} is a color: ${value}`)
    for (const hue of ['added', 'removed', 'modified', 'moved']) assert.equal(chrome[`--pj-${hue}`], tokens[`color-${hue}`])
  }
  assert.equal(hostChromeVariables({}, 'dark')['--pj-background'], defaultThemeTokens('dark')['color-surface-canvas'])
})
