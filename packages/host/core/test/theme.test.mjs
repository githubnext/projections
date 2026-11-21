import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {defaultThemeTokens} from '@githubnext/projections-renderer-sdk/protocol'
import {projectorPalette, projectorSurfaces, shadcnRendererTokens, sharedSurfaceNames} from '../dist/ui/lib/tokens.js'

/** The `--pj-*` declarations of theme.css's light (`.pj-root`) and dark (`.pj-root.pj-dark`) token blocks. */
async function themeTokens() {
  const css = await readFile(new URL('../src/ui/theme.css', import.meta.url), 'utf8')
  const block = selector => {
    const start = css.indexOf(`${selector} {\n    --pj-background`)
    assert.ok(start >= 0, `theme.css defines ${selector}`)
    const body = css.slice(start, css.indexOf('\n  }', start))
    return Object.fromEntries([...body.matchAll(/--pj-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
  }
  return {light: block('.pj-root'), dark: block('.pj-root.pj-dark')}
}

/** sRGB channels (0–1, gamma-encoded) of an `oklch(L C H)` color, clipped to the gamut. */
function oklchToSrgb(value) {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value)
  assert.ok(match, `an opaque oklch color: ${value}`)
  const [l, c, h] = match.slice(1).map(Number)
  const a = c * Math.cos((h * Math.PI) / 180),
    b = c * Math.sin((h * Math.PI) / 180)
  const [lms, mms, sms] = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map(v => v ** 3)
  const linear = [
    4.0767416621 * lms - 3.3077115913 * mms + 0.2309699292 * sms,
    -1.2684380046 * lms + 2.6097574011 * mms - 0.3413193965 * sms,
    -0.0041960863 * lms - 0.7034186147 * mms + 1.707614701 * sms,
  ]
  return linear.map(v => Math.min(1, Math.max(0, v))).map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
}

const hexToSrgb = value => [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255)
/** sRGB channels of a theme.css color: `oklch(L C H)`, or `#rrggbb[aa]` painted over `under` when translucent. */
const srgb = (value, under) => {
  if (!value.startsWith('#')) return oklchToSrgb(value)
  const alpha = value.length > 7 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1
  assert.ok(alpha === 1 || under, `${value} is painted over a surface`)
  return hexToSrgb(value).map((channel, index) => (alpha === 1 ? channel : channel * alpha + under[index] * (1 - alpha)))
}
const luminance = rgb => {
  const [r, g, b] = rgb.map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (x, y) => {
  const [high, low] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (high + 0.05) / (low + 0.05)
}

const text = 4.5
const nonText = 3

const surfaces = ['surface-canvas', 'surface-raised', 'surface-header', 'surface-inset']

/** Every pair the UI draws, with the WCAG AA minimum it must meet. */
function pairs(rgb) {
  const changes = ['added', 'removed', 'modified', 'moved']
  /** A change chip (views.tsx `statusTone`): the change's `-muted` fill over the raised surface. */
  const chip = change => rgb(`${change}-muted`, rgb('surface-raised'))
  return [
    // The shared surface scale: text on every surface, the divider against each of them.
    ...surfaces.flatMap(surface => [
      ['foreground', surface, text],
      ['muted-foreground', surface, text],
      ['divider', surface, nonText],
    ]),
    ['destructive', 'surface-raised', text],
    ['lens', 'surface-raised', nonText],
    // Change chips: text AA on the fill, and the same-hue edge 3:1 against the raised surface and the canvas.
    ...changes.map(change => [change, `${change} chip`, text, chip(change)]),
    ...changes.flatMap(change => ['surface-raised', 'surface-canvas'].map(surface => [`${change}-border`, surface, nonText])),
    ...['background', 'card', 'muted', 'accent', 'secondary', 'lens-muted'].map(surface => ['foreground', surface, text]),
    ['card-foreground', 'card', text],
    ['popover-foreground', 'popover', text],
    ...['background', 'card', 'muted', 'accent', 'popover', 'lens-muted'].map(surface => ['muted-foreground', surface, text]),
    ['primary-foreground', 'primary', text],
    ['secondary-foreground', 'secondary', text],
    ['accent-foreground', 'accent', text],
    ['destructive-foreground', 'destructive', text],
    ['lens-foreground', 'lens', text],
    ['destructive', 'background', text],
    ['destructive', 'card', text],
    // Change text, plain on the surfaces rows sit on.
    ...changes.flatMap(change => ['background', 'card', 'lens-muted', 'surface-raised'].map(surface => [change, surface, text])),
    // Focus, the lens marks and filled controls against their surfaces.
    ...['background', 'card', 'muted', 'popover', 'lens-muted'].map(surface => ['ring', surface, nonText]),
    ...['background', 'card', 'muted', 'accent'].map(surface => ['lens', surface, nonText]),
    ...['background', 'card', 'muted'].map(surface => ['primary', surface, nonText]),
    ['foreground', 'muted', nonText],
    // Control boundaries (WCAG 1.4.11): fields, checkboxes, select triggers and the slider track.
    ...['background', 'card', 'muted', 'popover'].map(surface => ['control-border', surface, nonText]),
    // `input` and `border` are decorative hairlines (dividers, cards, the lens's outer ring), held to the preview's floor.
    ...['background', 'card'].map(surface => ['input', surface, 1.5]),
  ]
}

for (const mode of ['light', 'dark']) {
  test(`the ${mode} Projector tokens meet WCAG AA contrast`, async () => {
    const tokens = (await themeTokens())[mode]
    const rgb = (name, under) => srgb(tokens[name], under)
    const failures = []
    for (const [foreground, background, minimum, surface] of pairs(rgb)) {
      const ratio = contrast(rgb(foreground), surface ?? rgb(background))
      if (ratio < minimum) failures.push(`${foreground} / ${background}: ${ratio.toFixed(2)} < ${minimum}`)
    }
    assert.deepEqual(failures, [])
  })
}

test('tokens.ts mirrors the theme.css palette', async () => {
  const tokens = await themeTokens()
  for (const [name, [light, dark]] of Object.entries(projectorPalette)) {
    assert.equal(tokens.light[name], light, `light --pj-${name}`)
    assert.equal(tokens.dark[name], dark, `dark --pj-${name}`)
  }
})

test("theme.css shares the surface scale and change fills with renderers: the token set's own values", async () => {
  const tokens = await themeTokens()
  assert.deepEqual(sharedSurfaceNames, [
    ...surfaces,
    'divider',
    ...['added', 'removed', 'modified', 'moved'].flatMap(change => [`${change}-muted`, `${change}-border`]),
  ])
  for (const mode of ['light', 'dark']) {
    const sdk = defaultThemeTokens(mode)
    for (const name of sharedSurfaceNames) {
      assert.equal(tokens[mode][name], sdk[`color-${name}`], `${mode} --pj-${name} is color-${name}`)
      assert.equal(projectorSurfaces[name][mode === 'dark' ? 1 : 0], sdk[`color-${name}`], `tokens.ts ${mode} ${name}`)
    }
  }
})

test('renderer tokens are sRGB, follow the Projector palette and keep annotation tones off the change colors', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = shadcnRendererTokens(mode)
    for (const [name, value] of Object.entries(tokens)) {
      assert.doesNotMatch(value, /oklch|oklab|color-mix|var\(/, `${mode} ${name} is a concrete sRGB value`)
      if (name.startsWith('color-') || name.startsWith('chart-')) assert.match(value, /^#[\da-f]{6}([\da-f]{2})?$/, `${mode} ${name}`)
    }
    assert.deepEqual(
      Object.fromEntries(Object.entries(tokens).filter(([name]) => name.startsWith('color-'))),
      Object.fromEntries(Object.entries(defaultThemeTokens(mode)).filter(([name]) => name.startsWith('color-'))),
    )
    // Attention badges use the accent (the lens), which must not read as a change.
    const changes = new Set(
      ['added', 'removed', 'modified', 'moved'].flatMap(change =>
        ['', '-muted', '-emphasis', '-highlight'].map(suffix => tokens[`color-${change}${suffix}`]),
      ),
    )
    for (const tone of ['color-accent', 'color-accent-emphasis', 'color-accent-muted', 'color-bg-subtle', 'color-fg-muted']) {
      assert.ok(!changes.has(tokens[tone]), `${mode} ${tone}`)
    }
    // The accent is the lens: the same hue as the UI's, and AA as text on the canvas.
    assert.ok(contrast(hexToSrgb(tokens['color-accent']), hexToSrgb(tokens['color-bg'])) >= text, `${mode} accent on bg`)
    assert.ok(contrast(hexToSrgb(tokens['color-focus']), hexToSrgb(tokens['color-bg'])) >= nonText, `${mode} focus on bg`)
  }
})
