import {test} from 'node:test'
import assert from 'node:assert/strict'
import {lintRendererStyles} from '../dist/style-lint.js'

test('a var() that names no theme token is an error, wherever it is', () => {
  const {errors} = lintRendererStyles(
    `.card { border-radius: var(--projections-radius-2, 6px); padding: var(--projections-space-2) var(--projections-spacing-3, 12px); }
.icon { mask: var(--projections-icon); }`,
    'src/styles.css',
  )
  assert.deepEqual(errors, [
    'src/styles.css:1: --projections-radius-2 is not a theme token, so its fallback always applies',
    'src/styles.css:1: --projections-spacing-3 is not a theme token, so its fallback always applies',
  ])
})

test('hard-coded colors, font sizes and families and !important are warnings; fallbacks and tokens are not', () => {
  const {errors, warnings} = lintRendererStyles(`
/* color: #fff in a comment is not a declaration */
.a { color: #3366cc; background: var(--projections-color-bg, #ffffff); }
.b { border: 1px solid rgb(0 0 0 / 0.2); fill: white; stroke: currentColor; }
.c { box-shadow: inset 3px 0 0 color-mix(in srgb, var(--green) 50%, transparent); }
.d { font-size: 11px; font-family: Georgia, serif; }
.e { font-size: var(--projections-font-size-sm); font-family: var(--projections-font-family-mono); font: inherit; }
.f { margin: 0 !important; }
:root[data-reduced-motion='true'] * { transition: none !important; animation: none !important; }
.g { background: url("data:image/svg+xml,%3Csvg fill='red'%3E"); }
`)
  assert.deepEqual(errors, [])
  assert.deepEqual(
    warnings.map(warning => warning.replace(/^styles:\d+: /, '').replace(/ \{.*\}: /, ': ')),
    [
      ".a: the color #3366cc isn't a theme token; use var(--projections-color-…) (token.color in TSX)",
      ".b: the color rgb(0 0 0 / 0.2) isn't a theme token; use var(--projections-color-…) (token.color in TSX)",
      ".b: the color white isn't a theme token; use var(--projections-color-…) (token.color in TSX)",
      ".d: a literal font size; use var(--projections-font-size-…), or the kit's Text",
      '.d: a font family of its own; use var(--projections-font-family) or var(--projections-font-family-mono)',
      '.f: !important; order rules instead',
    ],
  )
})
