// The attribution header of a vendored component: its shadcn/ui style and release, and its local changes.
import ts from 'typescript'
import {parse} from './source.mjs'

/** The two-line attribution header; `notes` are the file's local changes after the mechanical ones. */
export function header({style, version, notes = []}) {
  const changes = [
    '`pj:` class prefix and `--pj-` theme variables; imports from the individual @radix-ui packages and lucide-react',
    ...notes,
  ].join('; ')
  return [
    `// Adapted from shadcn/ui (https://ui.shadcn.com), style ${style}, shadcn@${version}. MIT License, Copyright (c) 2023`,
    `// shadcn; see LICENSE.shadcn.txt. Local changes: ${changes}.`,
  ]
}

const headerPattern = /^\/\/ Adapted from shadcn\/ui \(https:\/\/ui\.shadcn\.com\), style ([\w-]+), shadcn@([\w.+-]+)\./m
const notesPattern = /^\/\/ shadcn; see LICENSE\.shadcn\.txt\. Local changes: .*? lucide-react(?:; (.*))?\.$/m

/** Reads the style, version and extra local-change notes from a vendored file's header, or null if it has none. */
export function parseHeader(source) {
  const match = headerPattern.exec(source)
  if (!match) return null
  const notes = notesPattern.exec(source)?.[1]
  return {style: match[1], version: match[2], notes: notes ? splitNotes(notes) : []}
}

// Notes are joined with "; " but may contain parenthesised asides with their own semicolons.
function splitNotes(text) {
  const notes = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (depth === 0 && text.startsWith('; ', i)) {
      notes.push(text.slice(start, i))
      start = i + 2
    }
  }
  notes.push(text.slice(start))
  return notes
}

/** Puts the header first, after a leading directive such as `'use client'`. */
export function addHeader(text, lines) {
  const first = parse(text).statements[0]
  const directive = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first : null
  const block = `${lines.join('\n')}\n\n`
  if (!directive) return block + text.trimStart()
  return `${text.slice(0, directive.end)}\n\n${block}${text.slice(directive.end).trimStart()}`
}
