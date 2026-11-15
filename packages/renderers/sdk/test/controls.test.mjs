import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  controlValues,
  defaultThemeTokens,
  isControlValue,
  parseControls,
  parseHostMessage,
  parseRendererMessage,
  resolveThemeTokens,
  themeTokenNames,
  themeTokenSetVersion,
} from '../dist/index.js'

const channel = 'c'.repeat(32)
const envelope = message => ({projections: 0, channel, ...message})
const controls = [
  {
    id: 'layout',
    label: 'Layout',
    type: 'choice',
    default: 'v',
    choices: [
      {value: 'v', label: 'Vertical'},
      {value: 'h', label: 'Horizontal'},
    ],
  },
  {id: 'labels', label: 'Labels', type: 'toggle', default: true, description: 'Show labels', group: 'text', groupLabel: 'Text'},
  {id: 'zoom', label: 'Zoom', type: 'range', min: 50, max: 200, step: 10, default: 100, unit: '%', group: 'zoom'},
  {id: 'fit', label: 'Fit', type: 'action', icon: 'fit', group: 'zoom'},
]

test('valid control declarations parse, in ready and in controls messages', () => {
  assert.deepEqual(parseControls(controls), controls)
  assert.deepEqual(
    parseRendererMessage(envelope({type: 'ready', capabilities: {changeHighlighting: 'none', controls}}), channel)?.capabilities.controls,
    controls,
  )
  assert.deepEqual(parseRendererMessage(envelope({type: 'controls', controls}), channel), {type: 'controls', controls})
})

test('invalid control declarations are rejected', () => {
  const bad = [
    [...controls, controls[0]],
    [{...controls[0], default: 'x'}],
    [{...controls[0], choices: []}],
    [
      {
        ...controls[0],
        choices: [
          {value: 'v', label: 'A'},
          {value: 'v', label: 'B'},
        ],
      },
    ],
    [{...controls[1], default: 'yes'}],
    [{...controls[2], min: 300}],
    [{...controls[2], step: 0}],
    [{...controls[3], icon: 'rocket'}],
    [{...controls[3], extra: 1}],
    [{...controls[0], id: 'has space'}],
    [{...controls[0], label: ''}],
    [{...controls[1], groupLabel: ''}],
    [{...controls[1], groupLabel: 7}],
    [{id: 'x', label: 'X', type: 'dial', default: 1}],
    Array.from({length: 33}, (_, index) => ({id: `t${index}`, label: 'T', type: 'toggle', default: false})),
  ]
  for (const value of bad) assert.equal(parseControls(value), undefined, JSON.stringify(value).slice(0, 80))
  assert.equal(
    parseRendererMessage(envelope({type: 'ready', capabilities: {changeHighlighting: 'none', controls: bad[0]}}), channel),
    undefined,
  )
  assert.equal(parseRendererMessage(envelope({type: 'controls', controls: bad[1]}), channel), undefined)
})

test('control values fall back to defaults and reject invalid values', () => {
  assert.deepEqual(controlValues(controls, {layout: 'h', labels: 'no', zoom: 500, other: 1}), {layout: 'h', labels: true, zoom: 100})
  assert.equal(isControlValue(controls[2], 120), true)
  assert.equal(isControlValue(controls[3], true), false)
})

test('host action messages are strict', () => {
  assert.deepEqual(parseHostMessage(envelope({type: 'action', id: 'fit'}), channel), {type: 'action', id: 'fit'})
  assert.equal(parseHostMessage(envelope({type: 'action', id: ''}), channel), undefined)
})

test('the token set is versioned and complete in both color modes', () => {
  assert.equal(themeTokenSetVersion, 0)
  for (const mode of ['light', 'dark']) {
    const tokens = defaultThemeTokens(mode)
    assert.deepEqual(Object.keys(tokens), themeTokenNames)
    for (const value of Object.values(tokens)) assert.ok(value.length > 0)
  }
  for (let index = 1; index <= 16; index++) assert.ok(themeTokenNames.includes(`chart-${index}`))
  for (const change of ['added', 'removed', 'modified', 'moved']) {
    for (const suffix of ['', '-muted', '-highlight', '-emphasis']) assert.ok(themeTokenNames.includes(`color-${change}${suffix}`))
  }
  assert.equal(resolveThemeTokens({colorMode: 'dark', tokens: {'color-fg': 'red'}})['color-fg'], 'red')
  assert.equal(resolveThemeTokens({colorMode: 'dark', tokens: {}})['radius'], '8px')
})

/** Hue in degrees and saturation (0–1) of a `#rrggbb` color. */
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min
  const lightness = (max + min) / 2
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue =
    delta === 0 ? 0 : max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  return {hue: (hue + 360) % 360, saturation}
}

test('the first eight chart colors avoid the change hues', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = defaultThemeTokens(mode)
    const changes = ['added', 'removed', 'modified', 'moved'].map(change => hueOf(tokens[`color-${change}-emphasis`]).hue)
    for (let index = 1; index <= 8; index++) {
      const {hue, saturation} = hueOf(tokens[`chart-${index}`])
      if (saturation < 0.4) continue
      for (const change of changes) {
        const distance = Math.min(Math.abs(hue - change), 360 - Math.abs(hue - change))
        assert.ok(distance >= 15, `${mode} chart-${index} (${tokens[`chart-${index}`]}) is ${distance.toFixed(0)}° from a change hue`)
      }
    }
  }
})

test('theme tokens in host messages are bounded', () => {
  const theme = tokens => ({type: 'environment', theme: {colorMode: 'light', version: 0, tokens}, reducedMotion: false, locale: 'en'})
  assert.ok(parseHostMessage(envelope(theme({'color-fg': '#000'})), channel))
  assert.equal(parseHostMessage(envelope(theme({'Bad Name': '#000'})), channel), undefined)
  assert.equal(parseHostMessage(envelope(theme({'color-fg': 'x'.repeat(600)})), channel), undefined)
  assert.equal(
    parseHostMessage(envelope(theme(Object.fromEntries(Array.from({length: 300}, (_, index) => [`t${index}`, 'x'])))), channel),
    undefined,
  )
})
