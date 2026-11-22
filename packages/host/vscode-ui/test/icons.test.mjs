import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'
import {
  badgeIconNames,
  controlIcons,
  defaultThemeTokens,
  iconNames,
  iconToken,
  isIconValue,
} from '@githubnext/projections-renderer-sdk/protocol'
import {codiconNames, codiconTokens} from '../dist/icons.generated.js'
import {modeCodicons, uiCodicons, vscodeControlIcons} from '../dist/codicons.js'

const root = dirname(createRequire(import.meta.url).resolve('@vscode/codicons/package.json'))
const css = readFileSync(join(root, 'dist', 'codicon.css'), 'utf8')
const inFont = name => css.includes(`.codicon-${name}:before`)
/** The projection parts, Projections' own icons (brand/parts). */
const drawnHere = codicon => codicon.startsWith('part:')

test('the VS Code host maps every renderer icon, badge icons included, to a valid codicon image', () => {
  assert.deepEqual(Object.keys(codiconTokens).sort(), iconNames.map(iconToken).sort())
  for (const name of iconNames) assert.ok(isIconValue(codiconTokens[iconToken(name)]), name)
  for (const [name, codicon] of Object.entries(codiconNames)) {
    assert.ok(
      drawnHere(codicon) || readFileSync(join(root, 'src', 'icons', `${codicon}.svg`), 'utf8').includes('<svg'),
      `${name} → ${codicon}`,
    )
  }
})

test("every badge icon, breaking included, is the SDK's badge glyph, and every other icon a codicon", () => {
  assert.ok(badgeIconNames.includes('breaking'))
  const glyphs = defaultThemeTokens('dark')
  for (const name of iconNames) {
    assert.equal(codiconTokens[iconToken(name)] === glyphs[iconToken(name)], badgeIconNames.includes(name), name)
  }
  assert.deepEqual(Object.keys(codiconNames).sort(), iconNames.filter(name => !badgeIconNames.includes(name)).sort())
})

test('every codicon the UI draws is in the codicon font, and every control icon has one', () => {
  assert.deepEqual(Object.keys(vscodeControlIcons).sort(), [...controlIcons].sort())
  for (const name of [...Object.values(vscodeControlIcons), ...Object.values(modeCodicons), ...Object.values(uiCodicons)]) {
    assert.ok(inFont(name), `codicon-${name}`)
  }
})

test('no comparison mode is drawn with a playback glyph', () => {
  for (const name of Object.values(modeCodicons)) assert.doesNotMatch(name, /play|pause|debug|triangle|record/)
})
