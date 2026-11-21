import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {languageColor, languageNamed, languageOfPath, linguistRelease} from '../dist/languages.js'
import {defaultThemeTokens} from '../dist/tokens.js'
import {languages} from '../vendor/linguist/languages.js'
import {bundleNotices} from '../build/notices.mjs'
import {contrast, distance, oklch} from '../scripts/colors.mjs'
import {changeChromaRatio, chartPalette, profiles, separation} from '../scripts/calibration.mjs'

test('paths and names resolve to Linguist languages, variants to their group', () => {
  assert.match(linguistRelease, /^v\d+\.\d+\.\d+$/)
  const of = path => languageOfPath(path)?.name
  assert.equal(of('src/app.ts'), 'TypeScript')
  assert.equal(of('types/index.d.ts'), 'TypeScript')
  assert.equal(of('src/View.TSX'), 'TSX')
  assert.equal(languageOfPath('src/View.tsx').group, 'TypeScript')
  assert.equal(of('lib.rs'), 'Rust')
  assert.equal(of('include/x.h'), 'C')
  assert.equal(of('README.md'), 'Markdown')
  assert.equal(of('Dockerfile'), 'Dockerfile')
  assert.equal(of('Cargo.lock'), 'TOML')
  assert.equal(of('notes.unknownext'), undefined)
  assert.equal(languageNamed('bash')?.name, 'Shell')
  assert.equal(languageNamed('C Header')?.name, 'C')
  assert.equal(languageNamed('typescript')?.name, 'TypeScript')
  assert.equal(languageColor(languageOfPath('a.tsx'), 'light'), languageColor(languageNamed('TypeScript'), 'light'))
  assert.equal(languageColor(languageNamed('JSON'), 'light'), undefined, 'data languages get categorical colors')
  assert.equal(languageColor(languageNamed('Markdown'), 'dark'), undefined, 'prose languages too')
})

/** The least saturated change color (base, emphasis or border) of a theme: categories stay well under it. */
const changeChroma = tokens =>
  Math.min(
    ...['added', 'removed', 'modified', 'moved'].flatMap(change =>
      ['', '-emphasis', '-border'].map(suffix => oklch(tokens[`color-${change}${suffix}`])[1]),
    ),
  )

test('language colors keep their hue, calibrated to the theme: muted, one lightness band, 3:1 against the background', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = defaultThemeTokens(mode)
    const {chroma, band} = profiles.default[mode]
    let colored = 0
    for (const [name, type, , linguist, light, dark] of languages) {
      if (!linguist) continue
      colored++
      assert.ok(['programming', 'markup'].includes(type), name)
      const value = mode === 'light' ? light : dark
      const [L, C, h] = oklch(value)
      assert.ok(contrast(value, tokens['color-bg']) >= 3, `${name} ${mode} ${value} is ${contrast(value, tokens['color-bg']).toFixed(2)}:1`)
      assert.ok(C <= chroma + 0.003, `${name} ${mode} ${value} chroma ${C.toFixed(3)} is capped at ${chroma}`)
      assert.ok(C <= changeChroma(tokens) * changeChromaRatio, `${name} ${mode} is clearly less saturated than the change colors`)
      assert.ok(L >= band[0] - 0.06 && L <= band[1] + 0.06, `${name} ${mode} lightness ${L.toFixed(3)} is near the band`)
      const [, original, hue] = oklch(linguist)
      if (original > 0.05 && C > 0.03) {
        const shift = Math.abs(h - hue)
        assert.ok(Math.min(shift, 360 - shift) < 17, `${name} ${mode} keeps its hue`)
      }
    }
    assert.ok(colored > 400)
  }
  const color = name => languageNamed(name).color
  assert.equal(color('TypeScript').linguist, '#3178c6', "Linguist's own color is kept for reference")
  // The most common languages, which sit side by side, stay apart, and apart from the neutral "other".
  const common = [
    'TypeScript',
    'JavaScript',
    'Python',
    'Java',
    'C#',
    'C',
    'C++',
    'Go',
    'Rust',
    'Ruby',
    'PHP',
    'Kotlin',
    'Swift',
    'Shell',
    'HTML',
    'CSS',
  ]
  for (const mode of ['light', 'dark']) {
    const other = defaultThemeTokens(mode)['color-border-emphasis']
    for (const [index, name] of common.entries()) {
      assert.ok(distance(color(name)[mode], other) >= separation.wide - 1e-9, `${name} ${mode} is apart from "other"`)
      for (const later of common.slice(index + 1)) {
        assert.ok(distance(color(name)[mode], color(later)[mode]) >= separation.wide - 1e-9, `${mode}: ${name} and ${later} are apart`)
      }
    }
  }
})

test('the chart palette is sixteen distinct hues on the same calibration, none gray, and quieter than the change colors', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = defaultThemeTokens(mode)
    const {chroma, band} = profiles.default[mode]
    const chart = Array.from({length: 16}, (_, index) => tokens[`chart-${index + 1}`])
    for (const [index, value] of chart.entries()) {
      const [L, C] = oklch(value)
      assert.ok(contrast(value, tokens['color-bg']) >= 3, `${mode} chart-${index + 1} ${value}`)
      assert.ok(C >= chroma * 0.75 && C <= chroma + 0.003, `${mode} chart-${index + 1} ${value} has the palette's chroma, not gray`)
      assert.ok(
        C <= changeChroma(tokens) * changeChromaRatio,
        `${mode} chart-${index + 1} is clearly less saturated than the change colors`,
      )
      assert.ok(L >= band[0] - 0.03 && L <= band[1] + 0.03, `${mode} chart-${index + 1} lightness ${L.toFixed(3)} is in the band`)
      assert.ok(distance(value, tokens['color-border-emphasis']) >= 0.08, `${mode} chart-${index + 1} is apart from "other"`)
      for (const [later, other] of chart.entries()) {
        if (later > index) assert.ok(distance(value, other) >= 0.06, `${mode} chart-${index + 1} and chart-${later + 1} are apart`)
      }
    }
  }
})

test('the shipped tokens and table are what the calibration scripts generate', () => {
  const backgrounds = {light: defaultThemeTokens('light')['color-bg'], dark: defaultThemeTokens('dark')['color-bg']}
  const generated = chartPalette(profiles.default, backgrounds)
  for (const mode of ['light', 'dark']) {
    for (const [index, pair] of generated.entries()) {
      assert.equal(defaultThemeTokens(mode)[`chart-${index + 1}`], pair[mode === 'light' ? 0 : 1])
    }
  }
})

test('vendored third-party data in a bundle is attributed with its license', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projections-vendor-'))
  try {
    const directory = join(root, 'vendor', 'tables')
    await mkdir(directory, {recursive: true})
    await writeFile(join(directory, 'vendor.json'), JSON.stringify({name: 'example tables', version: 'v1.2.3', license: 'MIT'}))
    await writeFile(join(directory, 'LICENSE'), 'Copyright (c) 2020 Example\n\nPermission is hereby granted.\n')
    await writeFile(join(directory, 'tables.js'), 'export const x = 1\n')
    const notices = bundleNotices('Title', [join(directory, 'tables.js'), join(root, 'src', 'own.js')])
    assert.match(notices, /===== example tables v1\.2\.3 \(MIT\) =====/)
    assert.match(notices, /Copyright \(c\) 2020 Example/)
    assert.match(notices, /--- LICENSE ---/)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
