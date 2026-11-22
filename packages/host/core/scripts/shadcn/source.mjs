// Parsing a component's TSX and applying text edits to it, for the transforms that rewrite parts of its source.
import ts from 'typescript'

export const parse = text => ts.createSourceFile('component.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

export function applyEdits(text, edits) {
  let output = text
  for (const {start, end, replacement} of [...edits].toSorted((a, b) => b.start - a.start)) {
    output = output.slice(0, start) + replacement + output.slice(end)
  }
  return output
}
