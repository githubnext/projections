// The documentation the extension opens inside VS Code (dist/docs): a built-in part's row in the Definition view and
// Go to Source… open its page in the Markdown preview, never the browser. It bundles the built-ins' pages
// (docs/builtins: one per built-in extractor, renderer and the default comparator, written for the people using them),
// the reference catalogs, and the Markdown those link to directly. A built-in's page keeps its place under docs/builtins
// (extractors/workspace-dependencies.md), so each preview's tab names its part. The extension opens the bundle's own
// files, so the preview resolves relative links between them natively: links between bundled pages are rewritten to
// their bundled names, and links to anything else go to the file on GitHub. `index.json` maps each built-in extractor
// (by id), renderer (by each of its handles) and the default comparator to its page, and each page to its file in the
// repository.
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {DOCS_BASE} from '../src/projections/docs.ts'

const posix = path.posix

/** The built-ins' pages, and the pages every bundle starts from: their index, the reference catalogs and the comparator's. */
export const builtinsDir = 'docs/builtins'
export const referencePages = {
  index: `${builtinsDir}/README.md`,
  extractors: 'docs/reference/extractors.md',
  renderers: 'docs/reference/renderers.md',
  comparator: `${builtinsDir}/comparators/default.md`,
}

/**
 * A repository file's name in the bundle: a built-in's page keeps its place under docs/builtins
 * (`docs/builtins/extractors/workspace-dependencies.md` → `extractors/workspace-dependencies.md`), their index is `index.md`, and a README is named after its
 * directory (`extractors/x/README.md` → `extractors/x.md`).
 */
export function bundledName(file) {
  if (file === referencePages.index) return 'index.md'
  if (file.startsWith(`${builtinsDir}/`)) return file.slice(builtinsDir.length + 1)
  return /\/README\.md$/.test(file) ? file.replace(/\/README\.md$/, '.md') : file
}

/** Each `## \`name\`` section of a generated reference page: its name, handles (renderers) and page (from the repository root). */
export function referenceSections(text, page) {
  const sections = []
  for (const section of text.split(/^## /m).slice(1)) {
    const name = /^`([^`]+)`/.exec(section)?.[1]
    const linked = /See \[its page\]\(([^)\s]+)\)/.exec(section)?.[1]
    if (!name || !linked) continue
    const handles = /^- Handles: (.*)$/m.exec(section)?.[1]
    sections.push({
      name,
      handles: handles ? [...handles.matchAll(/`([^`]+)`/g)].map(match => match[1]) : [name],
      page: posix.normalize(posix.join(posix.dirname(page), linked)),
    })
  }
  return sections
}

const imagePattern = /\.(png|jpe?g|gif|svg|webp)$/i

/**
 * A bundled page's text with its links rewritten (`file` is the page's path in the repository; `bundled` maps each
 * bundled repository file to its name in the bundle): a relative link to a bundled page becomes relative to this page's
 * bundled name, keeping its fragment; one to any other file in the repository goes to it on GitHub, an image becoming a
 * link to it (no image is bundled). Absolute and fragment-only links, and code blocks, are left as they are.
 */
export function rewriteLinks(text, file, bundled) {
  const self = bundled.get(file) ?? bundledName(file)
  const target = (href, image) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return undefined
    const [location = '', fragment] = href.split(/#(.*)/s)
    const resolved = posix.normalize(posix.join(posix.dirname(file), decodeURI(location)))
    if (resolved.startsWith('..')) return undefined
    const anchor = fragment === undefined ? '' : `#${fragment}`
    if (!image && bundled.has(resolved)) {
      const relative = posix.relative(posix.dirname(self), bundled.get(resolved))
      return `${encodeURI(relative)}${anchor}`
    }
    return `${DOCS_BASE}${encodeURI(resolved)}${anchor}`
  }
  const links = prose =>
    prose
      .replace(/(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*([^)\s]+)(\s+"[^"]*")?\s*\)/g, (whole, bang, label, href, title = '') => {
        const image = bang === '!' && imagePattern.test(href.split('#')[0])
        const rewritten = target(href, image)
        if (rewritten === undefined) return whole
        return image ? `[${label || posix.basename(href)}](${rewritten}${title})` : `${bang}[${label}](${rewritten}${title})`
      })
      .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/gm, (whole, start, href, rest) => {
        const rewritten = target(href, false)
        return rewritten === undefined ? whole : `${start}${rewritten}${rest}`
      })
  // Prose between fenced code blocks (a link's text may span lines); the blocks as they are.
  return text
    .split(/(^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$)/m)
    .map((part, index) => (index % 2 ? part : links(part)))
    .join('')
}

/** GitHub's heading anchor, as the Markdown preview makes them too: lowercase, punctuation dropped, spaces hyphens. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replaceAll(' ', '-')
}

/** The text with fenced code blocks and code spans blanked out, keeping offsets. */
const withoutCode = text =>
  text
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, block => block.replace(/[^\n]/g, ' '))
    .replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, span => span.replace(/[^\n]/g, ' '))

/** A page's anchors: its headings' slugs (repeats numbered) and HTML `id`s. */
export function anchors(text) {
  const found = new Set()
  const seen = new Map()
  for (const match of withoutCode(text).matchAll(/^#{1,6} +(.+?)[ \t]*#*[ \t]*$/gm)) {
    const heading = text
      .slice(match.index, match.index + match[0].length)
      .replace(/^#{1,6} +/, '')
      .replace(/[ \t]*#*[ \t]*$/, '')
    const plain = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .trim()
    const base = slug(plain)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    found.add(count ? `${base}-${count}` : base)
  }
  for (const match of text.matchAll(/<[a-z][^>]*?\s(?:id|name)=["']([^"']+)["']/gi)) found.add(match[1])
  return found
}

/**
 * Every link in the bundle that wouldn't work in the Markdown preview: a relative link must name a bundled page (and a
 * heading it has), a fragment a heading on its own page; anything else must be an `https:` or `mailto:` link, which the
 * preview hands to the browser. Each problem is `page: link: why`.
 */
export function bundleProblems(pages) {
  const problems = []
  const headings = new Map([...pages].map(([page, text]) => [page, anchors(text)]))
  for (const [page, text] of pages) {
    const scan = withoutCode(text)
    const hrefs = [
      ...[...scan.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(match => match[1]),
      ...[...scan.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*<?(\S+?)>?(?:\s|$)/gm)].map(match => match[1]),
      ...[...scan.matchAll(/<(?:a|img|source)\b[^>]*?\s(?:href|src)=["']([^"']+)["']/gi)].map(match => match[1]),
    ]
    for (const href of hrefs) {
      const problem = why => problems.push(`${page}: ${href}: ${why}`)
      if (/^(https|mailto):/i.test(href)) continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')) {
        problem('not a link the preview can open')
        continue
      }
      const [location = '', fragment] = href.split(/#(.*)/s)
      const target = location ? posix.normalize(posix.join(posix.dirname(page), decodeURI(location))) : page
      if (!pages.has(target)) problem('not a bundled page')
      else if (fragment !== undefined && !headings.get(target).has(decodeURIComponent(fragment)))
        problem(`${target} has no heading #${fragment}`)
    }
  }
  return problems
}

const exists = file =>
  stat(file).then(
    found => found.isFile(),
    () => false,
  )

/**
 * The bundle of the repository at `root` (the open-source workspace), without writing it: each page's bundled name and
 * text, and the index.
 */
export async function planDocs(root) {
  const read = file => readFile(path.join(root, file), 'utf8')
  const extractors = referenceSections(await read(referencePages.extractors), referencePages.extractors)
  const renderers = referenceSections(await read(referencePages.renderers), referencePages.renderers)
  const seeds = [
    referencePages.index,
    referencePages.extractors,
    referencePages.renderers,
    referencePages.comparator,
    ...extractors.map(item => item.page),
    ...renderers.map(item => item.page),
  ]
  for (const file of seeds) if (!(await exists(path.join(root, file)))) throw new Error(`${file} is listed but doesn't exist`)
  // The documentation pages the seeds link to directly (guides, contracts, models), so the links a built-in's page has
  // most often stay in VS Code. Package READMEs aren't bundled: they are for the people maintaining a built-in, and
  // its page links one ("How it works") on GitHub.
  const files = new Set(seeds)
  for (const file of seeds)
    for (const match of (await read(file)).matchAll(/\]\(\s*([^)\s#]+\.md)(?:#[^)\s]*)?(?:\s+"[^"]*")?\s*\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue
      const linked = posix.normalize(posix.join(posix.dirname(file), decodeURI(match[1])))
      if (linked.startsWith('docs/') && (await exists(path.join(root, linked)))) files.add(linked)
    }
  const bundled = new Map([...files].sort().map(file => [file, bundledName(file)]))
  const names = new Map()
  for (const [file, name] of bundled) {
    if (names.has(name)) throw new Error(`${file} and ${names.get(name)} would both be ${name} in the bundle`)
    names.set(name, file)
  }
  const pages = new Map()
  // Without front matter (a description for this repository's tools), which the preview would show as a table.
  for (const [file, name] of bundled)
    pages.set(name, rewriteLinks((await read(file)).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, ''), file, bundled))
  const index = {
    format: 'projections.vscode.docs',
    version: 0,
    extractors: Object.fromEntries(extractors.map(item => [item.name, bundled.get(item.page)])),
    renderers: Object.fromEntries(renderers.flatMap(item => item.handles.map(handle => [handle, bundled.get(item.page)]))),
    comparator: bundled.get(referencePages.comparator),
    sources: Object.fromEntries([...bundled].map(([file, name]) => [name, file])),
  }
  return {pages, index}
}

/** Writes the bundle of the repository at `root` to `destination` (its pages and index.json), and returns the index. */
export async function bundleDocs(root, destination) {
  const {pages, index} = await planDocs(root)
  await rm(destination, {recursive: true, force: true})
  for (const [name, text] of pages) {
    await mkdir(path.dirname(path.join(destination, name)), {recursive: true})
    await writeFile(path.join(destination, name), text)
  }
  await writeFile(path.join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  return index
}
