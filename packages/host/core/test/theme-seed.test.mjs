import {test} from 'node:test'
import assert from 'node:assert/strict'
import {appThemeTokens, formatThemeSeed, parseThemeSeed, parseThemeSeedText, themeSeedTokens} from '../dist/index.js'

/** A warm off-white harness and its dark twin. */
const harness = {
  light: {background: '#f7f6f3', text: '#2f2e2b', muted: '#75736d', border: '#e4e2dd', accent: '#c96442', sans: 'Inter, sans-serif'},
  dark: {background: '#1f1e1c', text: '#ecebe7', border: '#3a3935', accent: '#d97757'},
}

test('a seed takes both modes, trimmed, and maps each onto the app theme', () => {
  const {seed, error} = parseThemeSeed({...harness, light: {...harness.light, background: ' #f7f6f3 '}})
  assert.equal(error, undefined)
  assert.deepEqual(seed, harness)
  for (const mode of ['light', 'dark']) assert.deepEqual(themeSeedTokens(seed, mode), appThemeTokens(harness[mode], mode))
  assert.equal(themeSeedTokens(seed, 'light')['color-surface-canvas'], '#f7f6f3')
  assert.equal(themeSeedTokens(seed, 'light')['color-border'], '#e4e2dd')
  assert.equal(themeSeedTokens(seed, 'light')['font-family'], 'Inter, sans-serif')
})

test('a mode the seed leaves out keeps the page its own theme', () => {
  const {seed} = parseThemeSeed({light: harness.light})
  assert.ok(themeSeedTokens(seed, 'light'))
  assert.equal(themeSeedTokens(seed, 'dark'), undefined)
})

test('a seed is refused, with what is wrong, unless every value is a color or a plain font list', () => {
  const refused = {
    'not an object': [['#fff'], 'must be an object'],
    'no mode': [{}, 'must have "light", "dark" or both'],
    'an unknown mode': [{sepia: {background: '#fff'}}, '"sepia"'],
    'an unknown key': [{light: {background: '#fff', surface: '#eee'}}, 'theme.light has "surface"'],
    'no background': [{dark: {text: '#fff'}}, 'theme.dark needs a "background"'],
    'a number': [{light: {background: 0xffffff}}, 'theme.light.background must be a string'],
    'a named color': [{light: {background: 'white'}}, "theme.light.background isn't a color"],
    'CSS in a color': [{light: {background: '#fff;}body{display:none'}}, "theme.light.background isn't a color"],
    'a url()': [{light: {background: '#fff', border: 'url(https://example.com/x)'}}, "theme.light.border isn't a color"],
    'CSS in a family': [{light: {background: '#fff', sans: 'Inter;}*{color:red'}}, "theme.light.sans isn't a font family list"],
    'a long value': [{light: {background: '#fff', mono: `"${'a'.repeat(600)}"`}}, 'longer than 512'],
  }
  for (const [name, [value, message]] of Object.entries(refused)) {
    const result = parseThemeSeed(value)
    assert.equal(result.seed, undefined, name)
    assert.ok(result.error.includes(message), `${name}: ${result.error}`)
  }
})

test('the URL form is the JSON text, round trip', () => {
  const text = formatThemeSeed({dark: harness.dark, light: {accent: '#c96442', background: '#f7f6f3'}})
  assert.equal(
    text,
    '{"light":{"background":"#f7f6f3","accent":"#c96442"},"dark":{"background":"#1f1e1c","text":"#ecebe7","border":"#3a3935","accent":"#d97757"}}',
  )
  const url = new URL(`http://127.0.0.1/token/?viewer=side&theme=${encodeURIComponent(text)}`)
  assert.deepEqual(parseThemeSeedText(url.searchParams.get('theme')).seed, JSON.parse(text))
  // A `#` left unencoded starts the fragment, and what is left isn't JSON.
  const unencoded = new URL(`http://127.0.0.1/token/?theme={"light":{"background":"#f7f6f3"}}`)
  assert.match(parseThemeSeedText(unencoded.searchParams.get('theme')).error, /percent-encode/)
  assert.match(parseThemeSeedText(`{"light":{"background":"${' '.repeat(5000)}"}}`).error, /longer than 4096/)
})
