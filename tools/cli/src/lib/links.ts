// Link checking: every relative link and `#anchor` in the repository's Markdown resolves, as GitHub renders it, and
// every `docs/….md` path named in source (schema descriptions, CLI help, comments) exists.
import {headings, parseFrontMatter} from './markdown.ts'
import type {Problem} from './problems.ts'
import {posix, readText, walk} from './repo.ts'
import {spawnSync} from 'node:child_process'
import {statSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'

/** GitHub's heading anchor: lowercase, punctuation other than `-` and `_` dropped, each space a hyphen. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replaceAll(' ', '-')
}

/** Every anchor a Markdown page defines: heading slugs (repeats numbered `-1`, `-2`…) and HTML `id`/`name` attributes. */
export function anchors(markdown: string): Set<string> {
  const found = new Set<string>()
  const seen = new Map<string, number>()
  for (const heading of headings(parseFrontMatter(markdown).body)) {
    const base = slug(heading.text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    found.add(count ? `${base}-${count}` : base)
  }
  for (const match of blankCode(markdown).matchAll(/<[a-z][^>]*?\s(?:id|name)=["']([^"']+)["']/gi)) found.add(match[1]!)
  return found
}

/** Fenced blocks and code spans replaced by spaces, keeping offsets and line numbers. */
function blankCode(markdown: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  let fence: string | undefined
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const kept = lines.map(line => {
    const marker = /^\s{0,3}(\x60{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined
      return blank(line)
    }
    if (marker) {
      fence = marker
      return blank(line)
    }
    return line
  })
  return kept.join('\n').replace(/(\x60+)(?!\x60)[\s\S]*?(?<!\x60)\1(?!\x60)/g, blank)
}

export interface Link {
  target: string
  line: number
}

/** Every link target in Markdown outside code: inline links and images, reference definitions, HTML `href`/`src`. */
export function links(markdown: string): Link[] {
  const text = blankCode(markdown)
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length
  const found: Link[] = []
  const inline = /\]\(\s*(<[^>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  const definition = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm
  const html = /<(?:a|img|source|link)\b[^>]*?\s(?:href|src|srcset)=["']([^"']+)["']/gi
  for (const pattern of [inline, definition, html]) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1]!.replace(/^<(.*)>$/, '$1').trim()
      if (target) found.push({target, line: lineAt(match.index)})
    }
  }
  return found.toSorted((a, b) => a.line - b.line)
}

/** Links to other sites, mail and the like: anything with a scheme or a host. */
const external = (target: string) => /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function kind(root: string, path: string): 'file' | 'directory' | undefined {
  try {
    const stat = statSync(join(root, path))
    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined
  } catch {
    return undefined
  }
}

interface Pages {
  anchors(path: string): Set<string>
}

/** Reads and caches each page's anchors. */
function pagesIn(root: string): Pages {
  const cache = new Map<string, Set<string>>()
  return {
    anchors(path) {
      let found = cache.get(path)
      if (!found) cache.set(path, (found = anchors(readText(root, path) ?? '')))
      return found
    },
  }
}

/**
 * Resolves `target` (a path, optionally with `#anchor`) against the repository-relative directory `from`. Returns
 * the problem, if any: a path outside the repository, a missing file, or an anchor its Markdown page lacks.
 */
function resolveTarget(root: string, pages: Pages, from: string, target: string, self: string): string | undefined {
  const hash = target.indexOf('#')
  const rawPath = (hash < 0 ? target : target.slice(0, hash)).replace(/\?.*$/, '')
  const anchor = hash < 0 ? undefined : decode(target.slice(hash + 1))
  if (rawPath.startsWith('/')) return `${target}: a root-relative link breaks when the repository moves; use a relative path`
  const path = rawPath ? posix(normalize(join(from, decode(rawPath)))).replace(/\/$/, '') : self
  if (path === '..' || path.startsWith('../')) return `${target} points outside the repository`
  const found = kind(root, path)
  if (!found) return `${target}: ${path} does not exist`
  if (!anchor || /^L\d+(-L\d+)?$/.test(anchor)) return undefined
  const page = found === 'directory' ? (kind(root, `${path}/README.md`) ? `${path}/README.md` : undefined) : path
  if (!page?.endsWith('.md')) return undefined
  if (!pages.anchors(page).has(anchor)) return `${target}: ${page} has no heading or anchor #${anchor}`
  return undefined
}

/** Problems with the relative links in the Markdown files given (repository-relative paths). */
export function markdownLinkProblems(root: string, files: readonly string[]): Problem[] {
  const pages = pagesIn(root)
  const problems: Problem[] = []
  for (const file of files) {
    const text = readText(root, file)
    if (text === undefined) continue
    for (const link of links(text)) {
      if (external(link.target)) continue
      const message = resolveTarget(root, pages, posix(dirname(file)), link.target, file)
      if (message) problems.push({file, line: link.line, message: `Broken link: ${message}`})
    }
  }
  return problems
}

/** Problems with `docs/….md` paths (and their anchors) named in the source files given, read from the repository root. */
export function docPathProblems(root: string, files: readonly string[]): Problem[] {
  const pages = pagesIn(root)
  const problems: Problem[] = []
  for (const file of files) {
    const text = readText(root, file)
    if (text === undefined) continue
    text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/(?<![\w.-])docs\/[\w./-]*?\.md(#[\w-]+)?(?![\w-])/g)) {
        // A URL's path (`https://example.com/docs/x.md`) is another site's, not a page here.
        if (/https?:\/\/\S*$/.test(line.slice(0, match.index))) continue
        const message = resolveTarget(root, pages, '.', match[0], file)
        if (message) problems.push({file, line: index + 1, message: `Missing documentation page: ${message}`})
      }
    })
  }
  return problems
}

/** Test inputs, fixtures and golden outputs: they name paths that need not exist. */
const scaffolding = /(^|\/)(tests?|fixtures?|golden|snapshots|__snapshots__)(\/|$)|(^|\/)[^/]*(\.test\.|fixtures?\.)[^/]*$/

/** Source text that can name documentation pages: code, schemas, manifests and workflows. */
const source = /\.(?:[cm]?[jt]sx?|rs|cs|go|py|sh|json|jsonc|ya?ml|toml|html|css)$/

/** The repository's files as git sees them (tracked, plus untracked files that aren't ignored), else a walk. */
export function repositoryFiles(root: string): string[] {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (listed.status !== 0) return walk(root)
  return [...new Set(listed.stdout.split('\0').filter(Boolean))].filter(path => kind(root, path) === 'file').toSorted()
}

/** Every link problem in the repository: Markdown links and anchors, then documentation paths named in source. */
export function linkProblems(root: string, files: readonly string[] = repositoryFiles(root)): Problem[] {
  const markdown = files.filter(path => path.endsWith('.md') && !scaffolding.test(path))
  const sources = files.filter(
    path => source.test(path) && !scaffolding.test(path) && !/(^|\/)(package-lock\.json|Cargo\.lock)$/.test(path),
  )
  return [...markdownLinkProblems(root, markdown), ...docPathProblems(root, sources)]
}
