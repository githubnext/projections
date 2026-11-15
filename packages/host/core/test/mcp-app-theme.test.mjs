import {test} from 'node:test'
import assert from 'node:assert/strict'
import {contrast, copilotCanvasThemeTokens, defaultThemeTokens, lightDark, mcpAppThemeTokens, parseColor} from '../dist/index.js'

/** A host's standardized style variables, theme-aware with `light-dark()`, as MCP Apps hosts pass them. */
const variables = {
  '--color-background-primary': 'light-dark(#ffffff, #1a1a1a)',
  '--color-text-primary': 'light-dark(#1f2937, #f3f4f6)',
  '--color-text-secondary': 'light-dark(#6b7280, #9ca3af)',
  '--color-border-primary': 'light-dark(#e5e7eb, #404040)',
  '--color-ring-primary': 'light-dark(#3b82f6, #60a5fa)',
  '--color-text-info': 'light-dark(#1d4ed8, #60a5fa)',
  '--font-sans': "system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--font-mono': "ui-monospace, 'SF Mono', monospace",
}

test('light-dark() takes the side for the color mode, nested functions included', () => {
  assert.equal(lightDark('light-dark(#fff, #000)', 'light'), '#fff')
  assert.equal(lightDark('light-dark(#fff, #000)', 'dark'), '#000')
  assert.equal(lightDark('light-dark(rgba(1, 2, 3, 0.5), rgb(4 5 6))', 'light'), 'rgba(1, 2, 3, 0.5)')
  assert.equal(lightDark('light-dark(rgba(1, 2, 3, 0.5), rgb(4 5 6))', 'dark'), 'rgb(4 5 6)')
  assert.equal(lightDark(' #123456 ', 'dark'), '#123456')
  assert.equal(lightDark('light-dark(#fff)', 'dark'), undefined)
  assert.equal(lightDark(undefined, 'dark'), undefined)
})

for (const colorMode of ['light', 'dark']) {
  test(`${colorMode}: the stage, text, rules, focus, accent and families are the host's`, () => {
    const tokens = mcpAppThemeTokens(variables, colorMode)
    const side = name => lightDark(variables[name], colorMode)
    assert.equal(tokens['color-surface-canvas'], side('--color-background-primary'))
    assert.equal(tokens['color-fg'], side('--color-text-primary'))
    assert.equal(tokens['color-border'], side('--color-border-primary'))
    assert.equal(tokens['color-focus'], side('--color-ring-primary'))
    assert.equal(tokens['font-family'], variables['--font-sans'])
    assert.equal(tokens['font-family-mono'], variables['--font-mono'])
    for (const surface of ['color-surface-canvas', 'color-surface-raised', 'color-surface-header', 'color-surface-inset'])
      assert.ok(contrast(parseColor(tokens['color-fg-muted']), parseColor(tokens[surface])) >= 4.5, `muted on ${surface}`)
    assert.ok(contrast(parseColor(tokens['color-accent']), parseColor(tokens['color-surface-canvas'])) >= 4.5)
  })

  test(`${colorMode}: the same colors map as the Copilot canvas's do`, () => {
    const copilot = copilotCanvasThemeTokens(
      {
        '--background-color-default': lightDark(variables['--color-background-primary'], colorMode),
        '--text-color-default': lightDark(variables['--color-text-primary'], colorMode),
        '--text-color-muted': lightDark(variables['--color-text-secondary'], colorMode),
        '--border-color-default': lightDark(variables['--color-border-primary'], colorMode),
        '--color-focus-outline': lightDark(variables['--color-ring-primary'], colorMode),
        '--font-sans': variables['--font-sans'],
        '--font-mono': variables['--font-mono'],
      },
      colorMode,
    )
    assert.deepEqual(mcpAppThemeTokens(variables, colorMode), copilot)
  })
}

test('without a background there is no host theme; a missing ring takes the info color as the accent', () => {
  assert.deepEqual(mcpAppThemeTokens({}, 'dark'), {})
  assert.deepEqual(mcpAppThemeTokens({'--color-background-primary': 'light-dark(#fff)'}, 'dark'), {})
  const tokens = mcpAppThemeTokens(
    {'--color-background-primary': '#ffffff', '--color-text-info': '#1d4ed8', '--font-sans': 'x; } body { display: none'},
    'light',
  )
  assert.equal(tokens['color-accent'], '#1d4ed8')
  assert.equal(tokens['color-focus'], '#1d4ed8')
  assert.equal(tokens['color-fg'], defaultThemeTokens('light')['color-fg'])
  assert.equal(tokens['font-family'], undefined)
})
