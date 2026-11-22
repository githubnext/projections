import {test} from 'node:test'
import assert from 'node:assert/strict'
import {defaultThemeTokens} from '../dist/protocol.js'

/** WCAG contrast ratio of two opaque #rrggbb colors. */
function contrast(a, b) {
  const luminance = hex => {
    const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    const linear = value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const surfaces = ['color-surface-canvas', 'color-surface-raised', 'color-surface-header', 'color-surface-inset']

for (const mode of ['light', 'dark']) {
  const tokens = defaultThemeTokens(mode)
  test(`${mode}: stacked surfaces step visibly, and the divider separates any two at 3:1 or more`, () => {
    for (const name of [...surfaces, 'color-divider']) assert.match(tokens[name], /^#[0-9a-f]{6}$/u, name)
    const [canvas, raised, header, inset] = surfaces.map(name => tokens[name])
    for (const [a, b, label] of [
      [canvas, raised, 'canvas and card'],
      [raised, header, 'card and header band'],
      [raised, inset, 'card and inset gutter'],
    ]) {
      assert.ok(contrast(a, b) >= 1.07, `${label} are a visible step apart (${contrast(a, b).toFixed(2)})`)
    }
    for (const name of surfaces) {
      assert.ok(
        contrast(tokens['color-divider'], tokens[name]) >= 3,
        `divider on ${name}: ${contrast(tokens['color-divider'], tokens[name]).toFixed(2)}`,
      )
    }
  })
  test(`${mode}: every change region pairs its fill with an edge in the same hue at 3:1 or more`, () => {
    for (const change of ['added', 'removed', 'modified', 'moved']) {
      assert.ok(tokens[`color-${change}-muted`], `${change} fill`)
      const edge = tokens[`color-${change}-border`]
      assert.match(edge, /^#[0-9a-f]{6}$/u, `${change} edge`)
      for (const surface of ['color-surface-raised', 'color-surface-canvas']) {
        assert.ok(contrast(edge, tokens[surface]) >= 3, `${change} edge on ${surface}: ${contrast(edge, tokens[surface]).toFixed(2)}`)
      }
    }
  })
}
