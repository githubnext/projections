// Built-in pages: one authored page per built-in extractor, renderer and the default comparator (docs/builtins), the
// pages VS Code opens from a built-in's row. Their prose is written by hand; the facts that come from the catalog, the
// renderer manifests and the schemas are generated into marked regions, so they can't drift:
//
//   <!-- generated: NAME -->
//   …
//   <!-- end generated: NAME -->
import {readFile, readdir} from 'node:fs/promises'
import {join, posix} from 'node:path'
import {builtRenderers, code, fail, formatMarkdown, json, outDir, projections, root, run, sentence, table, trustText} from './shared.mjs'

const builtinsDir = 'docs/builtins'
/** Built-ins without a page, reported after the other pages are written. */
export const missingPages = []
const regionPattern = /<!-- generated: ([a-z-]+) -->\n[\s\S]*?<!-- end generated: \1 -->/gu
/** The extractor ids, renderer names and comparator a built-in page may describe, with each page's path. */
const builtinPage = {
  extractor: id => `${builtinsDir}/extractors/${id}.md`,
  renderer: name => `${builtinsDir}/renderers/${name}.md`,
  comparator: `${builtinsDir}/comparators/default.md`,
}
/** Host order: Diff first, then Side by side, Animated and Swipe; a comparison opens in the first a renderer supports. */
const hostModes = ['diff', 'side-by-side', 'animated', 'swipe']
const modeNames = {'side-by-side': 'Side by side', animated: 'Animated', swipe: 'Swipe', diff: 'Diff'}

/** A schema pattern of alternatives (`^(?:dependents|data\..+)$`) as its values: `dependents`, `data.<key>`. */
const patternValues = pattern => {
  const alternatives = /^\^\(\?:(.*)\)\$$/u.exec(pattern)?.[1]?.split('|')
  if (!alternatives) return `matches ${code(pattern)}`
  return alternatives.map(item => code(item.replace(/\\\.\.\+$/u, '.<key>').replace(/\\(.)/gu, '$1'))).join(' or ')
}

/** Fills a page's regions from `regions` (name → Markdown); a region the page lacks, or one it has that isn't known, fails. */
function fillRegions(file, text, regions) {
  const seen = new Set()
  const filled = text.replaceAll(regionPattern, (whole, name) => {
    if (!(name in regions)) fail(`${file}: unknown generated region "${name}"; it may have ${Object.keys(regions).join(', ')}`)
    seen.add(name)
    return `<!-- generated: ${name} -->\n${regions[name].trim()}\n<!-- end generated: ${name} -->`
  })
  const missing = Object.keys(regions).filter(name => !seen.has(name))
  if (missing.length) {
    fail(`${file}: add the generated region${missing.length > 1 ? 's' : ''} ${missing.map(name => `"${name}"`).join(', ')}`)
  }
  return filled
}

export async function builtins() {
  const catalog = JSON.parse(run(projections(), ['extractor', 'list', '--json'])).extractors
  const found = await builtRenderers()
  const definitionSchema = JSON.parse(await readFile(join(root, 'packages/schemas/schemas/definition/v0.json'), 'utf8'))
  const page = (file, from) => posix.relative(posix.dirname(from), file)
  const schemaLink = (schema, from) => {
    const name = schema.replace(/\/v\d+$/u, '')
    const target = `${outDir}/schemas/${name.replace(/\//gu, '-')}.md`
    return `[${code(schema)}](${page(target, from)})`
  }
  const rendererFor = handle => found.find(({manifest}) => manifest.handles.includes(handle))
  const rendererLink = (handle, from) => {
    const renderer = rendererFor(handle)
    return renderer ? `[${code(handle)}](${page(builtinPage.renderer(renderer.manifest.name), from)})` : code(handle)
  }
  const regionsByFile = new Map()

  for (const entry of catalog) {
    const file = builtinPage.extractor(entry.id)
    regionsByFile.set(file, {
      facts: [
        `- ID: ${code(entry.id)}`,
        `- Extraction schema: ${schemaLink(entry.schema, file)}`,
        `- Drawn by default with: ${rendererLink(entry.renderer, file)}`,
        `- Needs \`--trust\`: ${trustText[entry.trust] ?? code(entry.trust)}`,
        entry.detects?.length
          ? `- Suggested when the repository has: ${entry.detects.map(code).join(', ')}`
          : '- Never suggested by `projections explore`: add it yourself',
      ].join('\n'),
      inputs: Object.keys(entry.inputs ?? {}).length
        ? table(
            ['Input', 'Meaning'],
            Object.entries(entry.inputs).map(([name, meaning]) => [code(name), sentence(meaning)]),
          )
        : 'It takes no inputs.',
      definition: json(entry.template),
    })
  }

  for (const {pkg, manifest} of found) {
    const file = builtinPage.renderer(manifest.name)
    const defaults = catalog.filter(entry => manifest.handles.includes(entry.renderer))
    const modes = hostModes.filter(mode => (manifest.comparisonModes ?? ['animated', 'side-by-side', 'swipe']).includes(mode))
    const aliases = manifest.handles.filter(handle => handle !== manifest.name)
    const accepted = (manifest.accepts ?? [])
      .map(item => `${schemaLink(item.schema, file)}${item.vocabulary ? ` with the ${code(item.vocabulary)} vocabulary` : ''}`)
      .join(', ')
    const template = defaults[0] && {...defaults[0].template, renderer: defaults[0].renderer}
    regionsByFile.set(file, {
      facts: [
        `- Name: ${code(manifest.name)}${aliases.length ? `; also answers to ${aliases.map(code).join(', ')}` : ''}`,
        `- Draws: ${accepted || 'any extraction'}`,
        `- Comparison modes: ${modes.map(mode => modeNames[mode]).join(', ')}${modes.length > 1 ? `; a comparison opens in ${modeNames[modes[0]]}` : ''}`,
        `- Package: ${code(pkg.name)}`,
      ].join('\n'),
      extractors: defaults.length
        ? table(
            ['Built-in extractor', 'Its default `renderer`'],
            defaults.map(entry => [`[${code(entry.id)}](${page(builtinPage.extractor(entry.id), file)})`, code(entry.renderer)]),
          )
        : 'No built-in extractor uses it by default; name it in `renderer`.',
      definition: template ? json(template) : json({id: 'example', extractor: 'my-extractor', renderer: manifest.name}),
    })
  }

  const order = definitionSchema.$defs?.defaultComparatorOptions?.properties?.order
  if (!order) fail('packages/schemas/schemas/definition/v0.json has no $defs.defaultComparatorOptions.properties.order')
  regionsByFile.set(builtinPage.comparator, {
    options: table(
      ['Option', 'Values', 'Required'],
      Object.entries(order.properties).map(([name, value]) => [
        code(`order.${name}`),
        value.enum ? value.enum.map(code).join(', ') : value.pattern ? patternValues(value.pattern) : code(value.type),
        (order.required ?? []).includes(name) ? 'Yes, when `order` is given' : 'No',
      ]),
    ),
  })

  const index = `${builtinsDir}/README.md`
  const link = (file, label) => `[${label}](${page(file, index)})`
  regionsByFile.set(index, {
    extractors: table(
      ['Extractor', 'What it reads', 'Schema', 'Drawn with'],
      catalog.map(entry => [
        link(builtinPage.extractor(entry.id), code(entry.id)),
        sentence(entry.description),
        code(entry.schema),
        rendererLink(entry.renderer, index),
      ]),
    ),
    renderers: table(
      ['Renderer', 'What it draws', 'Also answers to'],
      found.map(({pkg, manifest}) => [
        link(builtinPage.renderer(manifest.name), manifest.title),
        sentence(pkg.description.replace(/^Built-in Projections [^:]*renderer:\s*/iu, '').replace(/^./u, first => first.toUpperCase())),
        manifest.handles
          .filter(handle => handle !== manifest.name)
          .map(code)
          .join(', ') || '—',
      ]),
    ),
  })

  const pages = {}
  for (const [file, regions] of regionsByFile) {
    let text
    try {
      text = await readFile(join(root, file), 'utf8')
    } catch {
      missingPages.push(file)
      continue
    }
    pages[file] = await formatMarkdown(file, fillRegions(file, text, regions))
  }
  for (const kind of ['extractors', 'renderers', 'comparators']) {
    const names = await readdir(join(root, builtinsDir, kind)).catch(() => [])
    for (const name of names) {
      if (!regionsByFile.has(`${builtinsDir}/${kind}/${name}`)) {
        fail(`${builtinsDir}/${kind}/${name} describes no built-in; remove it or rename it after one`)
      }
    }
  }
  return pages
}
