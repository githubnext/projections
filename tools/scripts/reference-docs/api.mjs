// SDK public APIs, read by our own public-API extractors, as reference pages.
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {code, exists, extract, header, root, table} from './shared.mjs'

/** Documentation comments by `file:line` of the declaration's first token, from the TypeScript sources. */
async function typescriptDocs(files) {
  const docs = new Map()
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = node => {
      const comments = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
      if (comments.length) {
        const doc = comments.at(-1)
        const body = ts.getTextOfJSDocComment(doc.comment) ?? ''
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        if (body.trim()) docs.set(`${file}:${line}`, body.trim())
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return docs
}

/** The workspaces whose APIs have reference pages, with a member table for each interface and class. */
export const apiPageWorkspaces = ['packages/renderers/sdk', 'packages/renderers/kit']

/** The renderer SDK's and kit's APIs, extracted from this checkout with each package's own tsconfig. */
async function typescriptApi() {
  const sdk = JSON.parse(await readFile(join(root, 'packages/renderers/sdk/package.json'), 'utf8'))
  const entrypoints = {}
  for (const subpath of Object.keys(sdk.exports)) {
    const file = `packages/renderers/sdk/src/${subpath === '.' ? 'index' : subpath.slice(2)}.ts`
    if (await exists(file)) entrypoints[subpath] = file
  }
  const sdkExtraction = extract('typescript-public-api', {tsconfig: 'packages/renderers/sdk/tsconfig.json', entrypoints}, {trusted: true})
  const kitExtraction = extract(
    'typescript-public-api',
    {
      tsconfig: 'packages/renderers/kit/tsconfig.json',
      entrypoints: {'.': 'packages/renderers/kit/src/index.ts', './react': 'packages/renderers/kit/src/react.ts'},
    },
    {trusted: true},
  )
  const sources = [...new Set([sdkExtraction, kitExtraction].flatMap(x => x.entities.flatMap(e => e.evidence ?? []).map(e => e.source)))]
  const docs = await typescriptDocs(sources.filter(file => !file.includes('node_modules')))
  return {sdk: sdkExtraction, kit: kitExtraction, docs}
}

let typescriptExtractions
export const typescriptOnce = () => (typescriptExtractions ??= typescriptApi())

/** Entities by parent, from the extraction's `contains` relationships. */
function tree(extraction) {
  const byId = new Map(extraction.entities.map(entity => [entity.id, entity]))
  const children = new Map()
  for (const relationship of extraction.relationships ?? []) {
    if (relationship.kind !== 'contains' || !byId.has(relationship.to)) continue
    if (!children.has(relationship.from)) children.set(relationship.from, [])
    children.get(relationship.from).push(byId.get(relationship.to))
  }
  // Items in a crate or module are top-level items, grouped on the page rather than nested.
  const container = new Set(extraction.entities.filter(entity => ['crate', 'module'].includes(entity.kind)).map(entity => entity.id))
  const parentOf = new Map()
  for (const [parent, list] of children) for (const child of list) parentOf.set(child.id, parent)
  const roots = extraction.entities.filter(entity => !parentOf.has(entity.id) || container.has(parentOf.get(entity.id)))
  return {byId, children, roots}
}
const location = entity => {
  const evidence = entity.evidence?.[0]
  return evidence?.source ? `${evidence.source}:${evidence.location?.line}` : undefined
}
/** A documentation comment as page content: its headings become bold lines, so they don't join the page's outline. */
function docText(text, language) {
  let fenced = false
  return (text ?? '')
    .split('\n')
    .map(line => {
      if (/^\s*\x60\x60\x60/u.test(line)) {
        fenced = !fenced
        // rustdoc treats an unlabeled block as Rust.
        return fenced && /^\s*\x60\x60\x60\s*$/u.test(line) ? line.replace('```', `\`\`\`${language}`) : line
      }
      if (fenced) return line
      const heading = /^#{1,6}\s(.*)$/u.exec(line)
      if (heading) return `**${heading[1].trimStart()}**`
      // Intra-doc links (rustdoc's [`Name`]) have no target on this page.
      return line.replaceAll(/\[(\x60[^\x60\]]+\x60)\](?![([])/gu, '$1')
    })
    .join('\n')
}
export const firstParagraph = text =>
  (text ?? '')
    .split(/\n\s*\n/u)[0]
    .replaceAll(/\s*\n\s*/gu, ' ')
    .trim()

export function apiPage({
  title,
  intro,
  outro = '',
  sources,
  extraction,
  docs,
  language,
  group,
  skip = () => false,
  name = entity => entity.label,
}) {
  const {children, roots} = tree(extraction)
  const describe = entity => {
    const doc = docs.get(location(entity))
    return doc && docText(doc, language)
  }
  const members = entity =>
    // Trait implementations are listed by rustdoc, not here; auto traits would fill every type's table.
    (children.get(entity.id) ?? []).filter(child => child.kind !== 'impl').toSorted((a, b) => a.label.localeCompare(b.label, 'en'))
  const sections = new Map()
  for (const entity of roots) {
    if (skip(entity)) continue
    const key = group(entity)
    if (key === undefined) continue
    if (!sections.has(key)) sections.set(key, [])
    sections.get(key).push(entity)
  }
  const item = entity => {
    const doc = describe(entity)
    const list = members(entity)
    return [
      `### ${code(name(entity))}`,
      `\`\`\`${language}\n${entity.data?.signature ?? entity.label}\n\`\`\``,
      doc,
      list.length
        ? table(
            ['Member', 'Signature', 'Description'],
            list.map(member => [
              code(member.label),
              code(member.data?.signature ?? member.label),
              // Inherited members (an `Error` subclass's `message`) are located at the class, whose comment isn't theirs.
              location(member) === location(entity) ? '' : firstParagraph(describe(member)),
            ]),
          )
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return `${header(sources)}# ${title}

${intro}

${[...sections]
  .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
  .map(
    ([key, entities]) =>
      `## ${key}\n\n${entities
        .toSorted((a, b) => name(a).localeCompare(name(b), 'en'))
        .map(item)
        .join('\n\n')}`,
  )
  .join('\n\n')}
${outro ? `\n${outro}` : ''}`
}
