import {optionalThemeTokenNames, themeTokenNames} from './tokens.js'

/*
 * The renderer build's style lint: what a renderer's own CSS may not do, read from its source before Vite bundles
 * it. Unknown theme tokens are errors (a misspelt `var(--projections-…)` falls back silently, so the theme never
 * applies); hard-coded colors, font sizes and families and `!important` are warnings, which the renderer checks
 * (`palette`, `type-scale`, `spacing`) then measure as painted. Inline styles and SVG attributes are only measured.
 */

/** What `lintRendererStyles` found in one stylesheet, each message naming the file and line. */
export interface StyleLintResult {
  /** References to `--projections-*` properties that aren't theme tokens. */
  errors: string[]
  /** Values that bypass the theme. */
  warnings: string[]
}

/** `--projections-*` properties a renderer may reference that aren't tokens: a single element's icon override. */
const otherProperties = new Set(['icon'])
const namedColors =
  /^(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|olive|teal|aqua|fuchsia|lime|brown|gold|indigo|violet|crimson|coral|salmon|tomato|khaki|beige|ivory|lavender|tan|cyan|magenta)$/i
const colorProperties =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|stop-color|flood-color|lighting-color)$/

/** The value with the contents of `var(…)` (fallbacks included) and `url(…)` taken out, so only what it sets remains. */
function bare(value: string): string {
  let result = ''
  for (let index = 0; index < value.length;) {
    const match = /^(var|url)\(/i.exec(value.slice(index))
    if (!match) {
      result += value[index]
      index += 1
      continue
    }
    let depth = 0
    let end = index + match[0].length - 1
    for (; end < value.length; end++) {
      if (value[end] === '(') depth += 1
      else if (value[end] === ')' && --depth === 0) break
    }
    result += `${match[1]}()`
    index = end + 1
  }
  return result
}

function literalColor(value: string): string | undefined {
  const plain = bare(value)
  const functional = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/i.exec(plain)
  if (functional && !/^color-mix/i.test(functional[0])) return functional[0]
  const hex = /#[0-9a-f]{3,8}\b/i.exec(plain)
  if (hex) return hex[0]
  return plain.split(/[\s,/()]+/).find(word => namedColors.test(word))
}

/** Lints one stylesheet's source. `file` names it in messages. */
export function lintRendererStyles(css: string, file = 'styles'): StyleLintResult {
  const known = new Set<string>([...(themeTokenNames as readonly string[]), ...optionalThemeTokenNames, ...otherProperties])
  const errors: string[] = []
  const warnings: string[] = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
  const line = (offset: number) => source.slice(0, offset).split('\n').length
  for (const match of source.matchAll(/var\(\s*--projections-([a-z0-9-]+)/gi)) {
    if (!known.has(match[1]!))
      errors.push(`${file}:${line(match.index!)}: --projections-${match[1]} is not a theme token, so its fallback always applies`)
  }
  // Declarations, with the selector of the block they are in.
  for (const block of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = block[1]!.trim().replace(/\s+/g, ' ')
    const bodyStart = block.index! + block[0].indexOf('{') + 1
    for (const declaration of block[2]!.matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)) {
      const property = declaration[1]!.toLowerCase()
      const value = declaration[2]!.trim()
      if (property.startsWith('--')) continue
      const where = `${file}:${line(bodyStart + declaration.index!)}: ${selector} { ${property}: ${value} }`
      // Turning motion off for reduced motion is what `!important` is for.
      if (/!important/i.test(value) && !/^(?:transition|animation)(?:-|$)/.test(property))
        warnings.push(`${where}: !important; order rules instead`)
      if (colorProperties.test(property)) {
        const color = literalColor(value)
        if (color) warnings.push(`${where}: the color ${color} isn't a theme token; use var(--projections-color-…) (token.color in TSX)`)
      }
      const plain = bare(value)
      if (property === 'font-size' && /\d/.test(plain))
        warnings.push(`${where}: a literal font size; use var(--projections-font-size-…), or the kit's Text`)
      if (property === 'font-family' && !/^(?:inherit|initial|unset|var\(\))$/i.test(plain.trim()))
        warnings.push(`${where}: a font family of its own; use var(--projections-font-family) or var(--projections-font-family-mono)`)
    }
  }
  return {errors, warnings}
}
