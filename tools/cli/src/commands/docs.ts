// `docs search` and `docs read`: the repository's Markdown, without a network or a model.
import {TOOLS} from '../lib/gates.ts'
import {findDoc, loadDocs, search} from '../lib/docs.ts'
import {headings, section} from '../lib/markdown.ts'
import {UsageError} from './work/change-set.ts'

export function docsSearch(root: string, query: string, limit: number) {
  const hits = search(loadDocs(root), query, limit).map(({score: _score, ...hit}) => hit)
  return {
    query,
    hits,
    next: hits.length
      ? [`${TOOLS} docs read ${hits[0]?.path}${hits[0]?.section ? ` --section "${hits[0].section}"` : ''}`]
      : [`${TOOLS} docs search <fewer or other words>`],
  }
}

export function docsRead(root: string, target: string, options: {section?: string | undefined; maxLines: number}) {
  const docs = loadDocs(root)
  const {doc, candidates} = findDoc(docs, target)
  if (!doc) {
    throw new UsageError(
      candidates.length
        ? `${target} matches several documents: ${candidates.map(candidate => candidate.path).join(', ')}`
        : `No document matches ${target}`,
      candidates.length ? 'Pass a longer path' : `${TOOLS} docs search ${target}`,
    )
  }
  let text = doc.text
  if (options.section) {
    const body = section(doc.text, options.section)
    if (body === undefined)
      throw new UsageError(
        `${doc.path} has no section "${options.section}"`,
        `Sections: ${headings(doc.text)
          .map(heading => heading.text)
          .slice(0, 20)
          .join('; ')}`,
      )
    text = body
  }
  const lines = text.split('\n')
  const truncated = lines.length > options.maxLines
  return {
    path: doc.path,
    title: doc.title,
    lines: lines.length,
    text: truncated ? lines.slice(0, options.maxLines).join('\n') : text,
    truncated,
    ...(truncated
      ? {
          headings: headings(text)
            .filter(heading => heading.line > options.maxLines && heading.level <= 3)
            .map(heading => heading.text),
        }
      : {}),
    next: truncated ? [`${TOOLS} docs read ${doc.path} --section "<one of the headings>"`] : [],
  }
}
