import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  badgeDiscValue,
  badgeIconNames,
  defaultThemeTokens,
  iconMaskStyle,
  iconNames,
  iconToken,
  isIconValue,
  parseHostMessage,
  resolveThemeTokens,
  svgIconValue,
  themeTokenNames,
} from '../dist/protocol.js'

const css = readFileSync(new URL('../icons.css', import.meta.url), 'utf8')
const svgOf = value => decodeURIComponent(value.slice('url("data:image/svg+xml,'.length, -'")'.length))

test('every icon in the vocabulary is a theme token with a valid default in both color modes', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = defaultThemeTokens(mode)
    for (const name of iconNames) {
      assert.ok(themeTokenNames.includes(iconToken(name)), name)
      assert.ok(isIconValue(tokens[iconToken(name)]), `${name} in ${mode}`)
      assert.ok(tokens[iconToken(name)].length > 'url("data:image/svg+xml,")'.length, `${name} draws something`)
    }
  }
})

test('icons.css draws every name in the vocabulary from its token, and nothing else', () => {
  const drawn = [...css.matchAll(/\[data-icon=['"]([a-z-]+)['"]\] \{\s*--projections-icon: var\(--projections-icon-([a-z-]+)\);/g)]
  assert.deepEqual(
    drawn.map(([, name, token]) => [name, token]),
    iconNames.map(name => [name, name]),
  )
  assert.match(css, /mask: var\(--projections-icon\) center \/ contain no-repeat/)
  assert.match(css, /background-color: currentColor/)
})

test('icons.css draws exactly the badge icons as badges, breaking beside the change kinds, each glyph drawn for its disc at one stroke', () => {
  const badges = /:is\(([^)]*)\)\s*\{\s*--projections-icon-badge-default/.exec(css)?.[1] ?? ''
  assert.deepEqual(
    [...badges.matchAll(/\[data-icon='([a-z-]+)'\]/g)].map(([, name]) => name),
    [...badgeIconNames],
  )
  assert.ok(badgeIconNames.includes('breaking'))
  const tokens = defaultThemeTokens('light')
  // Drawn in the badge's own box, never scaled from another icon's, so a glyph's stroke is the stroke it is drawn with:
  // the same, once, for every badge. The browser suite measures the cut-outs' strokes and centres in pixels.
  const strokes = badgeIconNames.map(name => {
    const svg = svgOf(tokens[iconToken(name)])
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, name)
    assert.doesNotMatch(svg, /transform|scale|fill="#000"/, name)
    assert.equal(svg.match(/stroke-width=/g)?.length, 1, name)
    return /stroke-width="([\d.]+)"/.exec(svg)?.[1]
  })
  assert.deepEqual(new Set(strokes), new Set(['2.75']))
})

test('the arrow badges are one arrow turned in quarter turns, and redeploy is a ring concentric with the disc', () => {
  const tokens = defaultThemeTokens('light')
  const paths = name => [...svgOf(tokens[iconToken(name)]).matchAll(/ d="([^"]+)"/g)].map(([, d]) => d)
  const points = d => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)])
  const turned = (name, quarterTurns) =>
    paths(name).map(d =>
      points(d).map(([x, y]) => {
        let point = [x, y]
        for (let turn = 0; turn < quarterTurns; turn++) point = [point[1], 24 - point[0]]
        return point
      }),
    )
  const moved = paths('moved').map(points)
  assert.deepEqual(turned('downgraded', 1), moved)
  assert.deepEqual(turned('upgraded', 3), moved)
  // Its arc's endpoints at its radius from (12, 12).
  const [ring] = paths('redeploy')
  const [, x0, y0, radius, x1, y1] = /^M([\d.]+) ([\d.]+)A([\d.]+) [\d.]+ 0 1 1 ([\d.]+) ([\d.]+)$/.exec(ring).map(Number)
  for (const [x, y] of [
    [x0, y0],
    [x1, y1],
  ])
    assert.ok(Math.abs(Math.hypot(x - 12, y - 12) - radius) < 0.002, ring)
})

test('outside a frame, an icon masks as icons.css draws it: a badge is its disc with the glyph cut out', () => {
  // The disc is the one icons.css defaults to.
  const disc = /--projections-icon-badge-default: url\('([^']*)'\)/.exec(css)?.[1]
  // A name the theme lacks masks with an empty layer, so it draws nothing.
  const empty = 'linear-gradient(transparent, transparent)'
  assert.equal(`url("${disc}")`, badgeDiscValue)
  assert.ok(isIconValue(badgeDiscValue))
  for (const name of badgeIconNames) {
    const style = iconMaskStyle(name)
    const layers = `var(--projections-icon-${name}, ${empty}), var(--projections-icon-badge, ${badgeDiscValue})`
    assert.equal(style.maskImage, layers, name)
    assert.equal(style.WebkitMaskImage, layers, name)
    assert.equal(style.maskComposite, 'exclude', name)
    assert.equal(style.WebkitMaskComposite, 'xor', name)
  }
  for (const name of [...iconNames.filter(name => !badgeIconNames.includes(name)), 'lock']) {
    const style = iconMaskStyle(name)
    assert.equal(style.maskImage, `var(--projections-icon-${name}, ${empty})`, name)
    assert.equal(style.maskComposite, undefined, name)
    assert.equal(style.WebkitMaskComposite, undefined, name)
  }
  assert.deepEqual(
    Object.keys(iconMaskStyle('breaking')).filter(key => key.startsWith('mask')),
    ['maskImage', 'maskSize', 'maskRepeat', 'maskPosition', 'maskComposite'],
  )
})

test('icon token values are percent-encoded SVG data URLs; anything else is rejected', () => {
  const value = svgIconValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h(14)"/></svg>')
  assert.ok(isIconValue(value))
  assert.ok(!value.slice(5, -2).includes('(') && !value.slice(5, -2).includes(')'))
  for (const invalid of [
    'url("https://example.com/a.svg")',
    'url(data:image/svg+xml,%3Csvg%3E)',
    'url("data:image/svg+xml,<svg>")',
    'url("data:image/svg+xml,%3Csvg%3E") , url("https://x")',
    `url("data:image/svg+xml,${'a'.repeat(5000)}")`,
  ])
    assert.ok(!isIconValue(invalid), invalid)
  assert.ok(isIconValue('none'))
})

test('hosts may override icon tokens; an invalid icon value rejects the theme', () => {
  const channel = 'abcdefghijklmnop0123'
  const message = tokens => ({
    projections: 0,
    channel,
    type: 'environment',
    theme: {colorMode: 'light', tokens},
    reducedMotion: false,
    locale: 'en-US',
  })
  const override = svgIconValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>')
  assert.ok(parseHostMessage(message({'icon-warning': override}), channel))
  assert.equal(parseHostMessage(message({'icon-warning': 'url("https://example.com/a.svg")'}), channel), undefined)
  assert.equal(resolveThemeTokens({colorMode: 'dark', tokens: {'icon-warning': override}})['icon-warning'], override)
  // Every default token, icons included, fits the protocol's limits.
  assert.ok(parseHostMessage(message(defaultThemeTokens('dark')), channel))
})
