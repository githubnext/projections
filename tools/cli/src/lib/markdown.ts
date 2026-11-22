// Markdown helpers: README front matter, first paragraphs, titles and sections. No Markdown library: READMEs here
// use plain ATX headings and paragraphs, and the front matter is flat `key: value` YAML.

export interface FrontMatter {
  data: Record<string, string>
  body: string
  present: boolean
}

/** Splits leading `---` front matter (flat `key: value` pairs, quoted or not) from the body. */
export function parseFrontMatter(text: string): FrontMatter {
  const normalized = text.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized)
  if (!match) return {data: {}, body: normalized, present: false}
  const data: Record<string, string> = {}
  let key: string | undefined
  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^([A-Za-z][\w-]*):(.*)$/u.exec(line)
    if (pair) {
      key = pair[1]!
      data[key] = unquote((pair[2] ?? '').trim())
    } else if (key && /^\s+\S/u.test(line)) {
      // A folded continuation line (`description: >-`, or a plain scalar wrapped onto the next line).
      const previous = ['>-', '>', '|'].includes(data[key] ?? '') ? '' : (data[key] ?? '')
      data[key] = `${previous} ${line.trim()}`.trim()
    }
  }
  return {data, body: normalized.slice(match[0].length), present: true}
}

function unquote(value: string): string {
  const quote = value[0]
  if (value.length < 2 || (quote !== '"' && quote !== "'") || !value.endsWith(quote)) return value
  return value.slice(1, -1).replaceAll(quote === "'" ? "''" : '\\"', quote)
}

/** Removes front matter, leaving the Markdown a renderer without front matter support should show. */
export function stripFrontMatter(text: string): string {
  const {body, present} = parseFrontMatter(text)
  return present ? body.replace(/^\n+/u, '') : text
}

/** The text outside HTML tags, in one pass: each `<…>` with something inside is dropped; a `<` that closes nothing stays. */
export function withoutTags(text: string): string {
  let result = ''
  let index = 0
  for (;;) {
    const open = text.indexOf('<', index)
    const close = open < 0 ? -1 : text.indexOf('>', open + 1)
    if (close < 0) return result + text.slice(index)
    // `<>` is text, not a tag.
    result += close === open + 1 ? text.slice(index, close + 1) : text.slice(index, open)
    index = close + 1
  }
}

/** Inline Markdown to plain text: links and images to their text; code spans, emphasis and HTML tags removed. */
export function plain(markdown: string): string {
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
  return withoutTags(text)
    .replace(/\x60([^\x60]*)\x60/gu, '$1')
    .replace(/(\*\*|__)(.*?)\1/gu, '$2')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The first prose paragraph after the front matter and title: no headings, lists, quotes, fences, tables or HTML. */
export function firstParagraph(markdown: string): string | undefined {
  let fenced = false
  const paragraph: string[] = []
  for (const line of parseFrontMatter(markdown).body.split('\n')) {
    if (/^\s*(?:\x60\x60\x60|~~~)/u.test(line)) {
      fenced = !fenced
      if (paragraph.length) break
      continue
    }
    if (fenced) continue
    const prose = line.trim() !== '' && !/^\s*(?:[#>|<]|[-*+] |\d+\. |!\[|\[!\[)/u.test(line)
    if (prose) paragraph.push(line.trim())
    else if (paragraph.length) break
  }
  return plain(paragraph.join(' ')) || undefined
}

/** A heading's text after its `#`s and a space: without the spaces around it, or a closing run of `#`s. */
function headingText(rest: string): string {
  const text = rest.trim()
  const open = text.replace(/#+$/u, '').trimEnd()
  return open || text.slice(0, 1)
}

/** The first `# ` heading, as plain text. */
export function title(markdown: string): string | undefined {
  const match = /^# +(\S.*)$/mu.exec(parseFrontMatter(markdown).body)
  return match ? plain(match[1]!) || undefined : undefined
}

export interface Heading {
  level: number
  text: string
  line: number
}

/** Every ATX heading outside fenced code, with its 1-based line in the text given. */
export function headings(markdown: string): Heading[] {
  const found: Heading[] = []
  let fenced = false
  markdown
    .replaceAll('\r\n', '\n')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(?:\x60\x60\x60|~~~)/u.test(line)) fenced = !fenced
      const match = fenced ? null : /^(#{1,6}) (.+)$/u.exec(line)
      if (match) found.push({level: match[1]!.length, text: plain(headingText(match[2]!)), line: index + 1})
    })
  return found
}

/** The body of the first section whose heading is `name` (case-insensitive), up to the next heading of its level or above. */
export function section(markdown: string, name: string): string | undefined {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const all = headings(markdown)
  const wanted = name.trim().toLowerCase()
  const heading = all.find(candidate => candidate.text.toLowerCase() === wanted)
  if (!heading) return undefined
  const end = all.find(candidate => candidate.line > heading.line && candidate.level <= heading.level)
  return lines
    .slice(heading.line, end ? end.line - 1 : lines.length)
    .join('\n')
    .trim()
}

/** Top-level list items, each joined onto one line as plain text. */
export function listItems(markdown: string): string[] {
  const items: string[] = []
  for (const line of markdown.split('\n')) {
    if (/^[-*+] /u.test(line)) items.push(line.slice(2).trim())
    else if (/^\s+\S/u.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`
  }
  return items.map(plain)
}

export interface Description {
  description: string | undefined
  source: 'front-matter' | 'first-paragraph' | 'missing'
}

/** A README's description: front matter `description`, else its first paragraph (flagged as a fallback). */
export function describe(markdown: string | undefined): Description {
  if (markdown === undefined) return {description: undefined, source: 'missing'}
  const front = parseFrontMatter(markdown).data.description
  if (front) return {description: front, source: 'front-matter'}
  const paragraph = firstParagraph(markdown)
  return paragraph ? {description: paragraph, source: 'first-paragraph'} : {description: undefined, source: 'missing'}
}

/** Shortens text to at most `limit` characters, at a word boundary. */
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`
}
