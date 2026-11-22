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
  /^(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|olive|teal|aqua|fuchsia|lime|brown|gold|indigo|violet|crimson|coral|salmon|tomato|khaki|beige|ivory|lavender|tan|cyan|magenta)$/iu
const colorProperties =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|stop-color|flood-color|lighting-color)$/u

/** The value with the contents of `var(…)` (fallbacks included) and `url(…)` taken out, so only what it sets remains. */
function bare(value: string): string {
  let result = ''
  for (let index = 0; index < value.length;) {
    const match = /^(var|url)\(/iu.exec(value.slice(index))
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
  const functional = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/iu.exec(plain)
  if (functional && !/^color-mix/iu.test(functional[0])) return functional[0]
  const hex = /#[0-9a-f]{3,8}\b/iu.exec(plain)
  if (hex) return hex[0]
  return plain.split(/[\s,/()]+/u).find(word => namedColors.test(word))
}

/** The source with each closed comment's characters, but not its line breaks, blanked, so offsets and lines hold. */
function blankComments(css: string): string {
  let result = ''
  let index = 0
  for (;;) {
    const start = css.indexOf('/*', index)
    const end = start < 0 ? -1 : css.indexOf('*/', start + 2)
    // An unclosed comment is left as it is: with no `*/` after it, none after a later `/*` either.
    if (end < 0) return result + css.slice(index)
    result += css.slice(index, start) + css.slice(start, end + 2).replace(/[^\n]/gu, ' ')
    index = end + 2
  }
}

/** Each `{…}` with no braces inside, with the text since the brace before it as its selector, in one pass. */
function* innermostBlocks(source: string): Generator<{selector: string; body: string; bodyStart: number}> {
  let runStart = 0
  let selectorStart = 0
  let open = -1
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '{') {
      selectorStart = runStart
      open = index
    } else if (character === '}') {
      if (open >= 0) yield {selector: source.slice(selectorStart, open), body: source.slice(open + 1, index), bodyStart: open + 1}
      open = -1
    } else continue
    runStart = index + 1
  }
}

/** Lints one stylesheet's source. `file` names it in messages. */
export function lintRendererStyles(css: string, file = 'styles'): StyleLintResult {
  const known = new Set<string>([...(themeTokenNames as readonly string[]), ...optionalThemeTokenNames, ...otherProperties])
  const errors: string[] = []
  const warnings: string[] = []
  const source = blankComments(css)
  const line = (offset: number) => source.slice(0, offset).split('\n').length
  for (const match of source.matchAll(/var\(\s*--projections-([a-z0-9-]+)/giu)) {
    if (!known.has(match[1]!)) {
      errors.push(`${file}:${line(match.index!)}: --projections-${match[1]} is not a theme token, so its fallback always applies`)
    }
  }
  // Declarations, with the selector of the block they are in.
  for (const block of innermostBlocks(source)) {
    const selector = block.selector.trim().replace(/\s+/gu, ' ')
    const bodyStart = block.bodyStart
    for (const declaration of block.body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/giu)) {
      const property = declaration[1]!.toLowerCase()
      const value = declaration[2]!.trim()
      if (property.startsWith('--')) continue
      const where = `${file}:${line(bodyStart + declaration.index!)}: ${selector} { ${property}: ${value} }`
      // Turning motion off for reduced motion is what `!important` is for.
      if (/!important/iu.test(value) && !/^(?:transition|animation)(?:-|$)/u.test(property)) {
        warnings.push(`${where}: !important; order rules instead`)
      }
      if (colorProperties.test(property)) {
        const color = literalColor(value)
        if (color) warnings.push(`${where}: the color ${color} isn't a theme token; use var(--projections-color-…) (token.color in TSX)`)
      }
      const plain = bare(value)
      if (property === 'font-size' && /\d/u.test(plain)) {
        warnings.push(`${where}: a literal font size; use var(--projections-font-size-…), or the kit's Text`)
      }
      if (property === 'font-family' && !/^(?:inherit|initial|unset|var\(\))$/iu.test(plain.trim())) {
        warnings.push(`${where}: a font family of its own; use var(--projections-font-family) or var(--projections-font-family-mono)`)
      }
    }
  }
  return {errors, warnings}
}
