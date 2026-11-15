import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const source = fileURLToPath(new URL('../src/ui/theme.css', import.meta.url))
const defaultOutput = fileURLToPath(new URL('../dist/ui.css', import.meta.url))
const root = '.pj-root'
const allowedAtRules = new Set(['media', 'supports', 'container', 'keyframes', '-webkit-keyframes'])
const inKeyframes = node => {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === 'atrule' && parent.name.endsWith('keyframes')) return true
  return false
}

/**
 * Makes Tailwind v4's output safe to embed:
 *
 * - Cascade layers are removed, in their declared order (theme, base, components, utilities), because an embedding
 *   page's unlayered CSS would otherwise outrank every layered rule, whatever its specificity.
 * - Every selector is scoped under `.pj-root` (`:root`/`:host` theme variables move to `.pj-root` itself), so
 *   utilities become `.pj-root .pj\:…` and nothing matches outside the root.
 * - `@property` registrations are global; they become scoped per-element defaults instead (which also stops these
 *   non-inheriting variables from inheriting), and the `properties` fallback layer is dropped.
 * - Keyframes are renamed `pj-…` (and their uses updated), so they can't collide with a page's.
 * - rem follows the embedding page's `html` font size; px keeps the UI independent of it.
 */
function embeddingSafe() {
  return {
    postcssPlugin: 'projections-embedding-safe',
    OnceExit(css) {
      let order = []
      css.walkAtRules('layer', rule => {
        if (!rule.nodes) {
          if (!order.length) order = rule.params.split(',').map(name => name.trim())
          rule.remove()
        }
      })
      const defaults = []
      css.walkAtRules('property', rule => {
        let initial = 'initial',
          syntax = '*'
        rule.walkDecls('initial-value', declaration => {
          initial = declaration.value
        })
        rule.walkDecls('syntax', declaration => {
          syntax = declaration.value.replace(/["']/g, '')
        })
        // A registered zero keeps its type (minification writes `0px` as `0`); unregistered, `calc(1px + 0)` is invalid.
        if (initial === '0')
          initial = /length/.test(syntax)
            ? '0px'
            : /percentage/.test(syntax)
              ? '0%'
              : /time/.test(syntax)
                ? '0s'
                : /angle/.test(syntax)
                  ? '0deg'
                  : initial
        defaults.push([rule.params.trim(), initial])
        rule.remove()
      })
      css.walkAtRules('layer', rule => {
        if (rule.params.trim() === 'properties') rule.remove()
      })
      // Nested layers (sublayers) flatten in place.
      const flatten = nodes =>
        nodes.flatMap(node => (node.type === 'atrule' && node.name === 'layer' && node.nodes ? flatten(node.nodes) : [node]))
      const buckets = new Map(order.map(name => [name, []]))
      const header = [],
        rest = []
      for (const node of [...css.nodes]) {
        node.remove()
        if (node.type === 'atrule' && node.name === 'layer' && node.nodes) {
          const name = node.params.trim()
          if (!buckets.has(name)) buckets.set(name, [])
          buckets.get(name).push(...flatten(node.nodes))
        } else if (node.type === 'comment' && !header.length && !rest.length) {
          header.push(node)
        } else {
          rest.push(node)
        }
      }
      const scoped = [root, ...['', '::before', '::after', '::backdrop'].map(pseudo => `${root} :where(*)${pseudo}`)]
      const defaultsRule = postcss.rule({selectors: scoped})
      for (const [name, value] of defaults) defaultsRule.append({prop: name, value})
      const nodes = [...header, ...(defaults.length ? [defaultsRule] : []), ...[...buckets.values()].flat(), ...rest]
      for (const node of nodes) node.raws.before = '\n'
      css.append(...nodes)

      css.walkRules(rule => {
        if (inKeyframes(rule)) return
        const selectors = rule.selectors.map(selector =>
          /^(:root|:host)$/.test(selector)
            ? root
            : selector === root ||
                selector.startsWith(`${root} `) ||
                selector.startsWith(`${root}.`) ||
                selector.startsWith(`${root}:`) ||
                selector.startsWith(`${root}::`)
              ? selector
              : `${root} ${selector}`,
        )
        rule.selectors = [...new Set(selectors)]
      })

      const names = new Map()
      css.walkAtRules(/keyframes$/, rule => {
        const name = rule.params.trim()
        if (!name.startsWith('pj-')) names.set(name, `pj-${name}`)
        rule.params = names.get(name) ?? name
      })
      if (names.size) {
        const pattern = new RegExp(
          `(?<![\\w-])(${[...names.keys()].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`,
          'g',
        )
        css.walkDecls(declaration => {
          if (/^(animation|animation-name)$/.test(declaration.prop) || /^--(pj-animate|tw-animation)/.test(declaration.prop)) {
            declaration.value = declaration.value.replace(pattern, name => names.get(name))
          }
        })
      }

      css.walkDecls(declaration => {
        if (declaration.value.includes('rem')) {
          declaration.value = declaration.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, value) => `${Number((Number(value) * 16).toFixed(4))}px`)
        }
      })
    },
  }
}

/** Every problem that would let the stylesheet affect anything outside a `.pj-root` element. */
export function scopeViolations(css) {
  const problems = []
  const parsed = postcss.parse(css)
  parsed.walkAtRules(rule => {
    if (!allowedAtRules.has(rule.name)) problems.push(`@${rule.name} ${rule.params} is not allowed`)
    if (rule.name.endsWith('keyframes') && !rule.params.startsWith('pj-')) problems.push(`@${rule.name} ${rule.params} is not pj- prefixed`)
  })
  parsed.walkRules(rule => {
    if (inKeyframes(rule)) return
    if (rule.nodes?.some(node => node.type === 'rule')) problems.push(`nested rule under ${rule.selector}`)
    for (const selector of rule.selectors) {
      if (!selector.startsWith(root) || /^\.pj-root[\w-]/.test(selector)) problems.push(`selector escapes ${root}: ${selector}`)
    }
  })
  parsed.walkDecls(declaration => {
    if (declaration.prop.startsWith('--') && !/^--(pj|tw)-/.test(declaration.prop))
      problems.push(`custom property ${declaration.prop} is not --pj-/--tw- prefixed`)
    if (/\d(r?em)?rem\b/.test(declaration.value) || /\brem\b/.test(declaration.value))
      problems.push(`rem unit in ${declaration.prop}: ${declaration.value}`)
  })
  return problems
}

/** Compiles src/ui/theme.css into the embedding-safe dist/ui.css and verifies its scope. */
export async function buildUiCss({output = defaultOutput} = {}) {
  const result = await postcss([tailwindcss({optimize: {minify: false}}), embeddingSafe()]).process(await readFile(source, 'utf8'), {
    from: source,
    to: output,
  })
  const problems = scopeViolations(result.css)
  if (problems.length > 0) throw new Error(`ui.css is not scoped to ${root}:\n  ${problems.join('\n  ')}`)
  await mkdir(dirname(output), {recursive: true})
  await writeFile(output, result.css)
  return {output, bytes: Buffer.byteLength(result.css)}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {output, bytes} = await buildUiCss()
  console.log(`ui.css: ${bytes} bytes, scoped to ${root} (${output})`)
}
