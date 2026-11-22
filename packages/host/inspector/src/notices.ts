import type {ExtractionDocument} from '@githubnext/projections-schemas'

/**
 * Notices for declared inputs a revision lacks (an extraction's `missingInputs`), worded exactly as the CLI words them
 * (`artifact::missing_input_notices`), so a comparison computed here and one the CLI saved say the same thing once.
 */

/** At most this many missing inputs are named in a notice. */
const maxNamed = 5

/** `text` as an inline code span of protocol prose. */
function code(text: string): string {
  return `\`${text.replace(/[\x60\\]/g, character => `\\${character}`)}\``
}

/** How notices name an extraction's revision: `the working tree`, or the commit's first eight hex digits as code. */
export function revisionName(document: ExtractionDocument): string {
  const revision = document.provenance.revision
  return revision.kind === 'working-tree' ? 'the working tree' : code(revision.commit.slice(0, 8))
}

/** The declared inputs an extraction records as missing at its revision. */
export function missingInputs(document: ExtractionDocument | undefined): string[] {
  return [...(document?.extraction.missingInputs ?? [])]
}

function named(paths: readonly string[]): {text: string; verb: string; pronoun: string} {
  const names = paths.slice(0, maxNamed).map(code)
  if (paths.length > maxNamed) names.push(`${paths.length - maxNamed} more`)
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
  return paths.length === 1 ? {text, verb: "doesn't", pronoun: 'its'} : {text, verb: "don't", pronoun: 'their'}
}

/** Missing before, their contents show as added; missing after, as removed; missing on both, nothing to compare. */
export function missingInputNotices(before: ExtractionDocument, after: ExtractionDocument): string[] {
  const missingBefore = missingInputs(before)
  const missingAfter = missingInputs(after)
  const both = missingBefore.filter(path => missingAfter.includes(path))
  const notices: string[] = []
  for (const [paths, side, shown] of [
    [missingBefore.filter(path => !both.includes(path)), before, 'added'],
    [missingAfter.filter(path => !both.includes(path)), after, 'removed'],
  ] as const) {
    if (!paths.length) continue
    const {text, verb, pronoun} = named(paths)
    notices.push(`${text} ${verb} exist at ${revisionName(side)}, so ${pronoun} contents show as ${shown}.`)
  }
  if (both.length) {
    const {text, verb} = named(both)
    notices.push(
      `${text} ${verb} exist at ${revisionName(before)} or ${revisionName(after)}, so there is nothing of ${both.length === 1 ? 'it' : 'them'} to compare.`,
    )
  }
  return notices
}

/** One revision alone: what it lacks, and when it shows nothing, that the projection has nothing to show there. */
export function missingInputNotice(document: ExtractionDocument): string | undefined {
  const missing = missingInputs(document)
  if (!missing.length) return undefined
  const {text, verb, pronoun} = named(missing)
  const revision = revisionName(document)
  return document.extraction.entities.length
    ? `${text} ${verb} exist at ${revision}, so ${pronoun} contents aren't shown.`
    : `Projection ${code(document.projection.id)} has nothing to show at ${revision}: ${text} ${verb} exist there.`
}

/** Only a source location: `node:internal/modules/cjs/loader:1607`, `/app/x.js:3:9`, a stack frame or `File "x.py", line 3`. */
function isLocation(line: string): boolean {
  if (line.startsWith('at ') || (line.startsWith('File "') && line.includes('", line '))) return true
  return /^\(?\S*?:\d+(?::\d+)?\)?$/.test(line) && !/\s/.test(line)
}
const isCaret = (line: string) => line.includes('^') && /^[\^~ ]+$/.test(line)
const isNoise = (line: string) =>
  ['note: run with `RUST_BACKTRACE', 'stack backtrace:', 'Require stack:', 'Node.js v'].some(prefix => line.startsWith(prefix)) ||
  (line.startsWith('- ') && isLocation(line.slice(2).replace(/ /g, '')))
/** `Error: …`, `TypeError: …`, `ModuleNotFoundError: …`, `error[E0425]: …` or `fatal: …`. */
function isError(line: string): boolean {
  const head = /^(?:Uncaught )?([^\s:]+):/.exec(line)?.[1]?.toLowerCase()
  return Boolean(head && (head.endsWith('error') || head.endsWith('exception') || head.startsWith('error[') || head === 'fatal'))
}

/**
 * The line of a failed process's stderr that says what went wrong, as the CLI picks it (`runtime::diagnostics::reported`):
 * an extractor's own report, the first `Error:`-style line, a Python traceback's last line or a Rust panic's message;
 * never a location, a source excerpt with its caret, or a blank line.
 */
export function reported(stderr: string): string | undefined {
  const lines = stderr.split('\n').map(line => line.trim())
  const panic = lines.findIndex(line => line.startsWith("thread '") && line.includes("' panicked at "))
  if (panic >= 0) {
    const after = lines[panic]!.split("' panicked at ")[1] ?? ''
    if (after.startsWith("'")) {
      const end = after.lastIndexOf("', ")
      if (end > 0) return after.slice(1, end)
    } else {
      const next = lines.slice(panic + 1).find(line => line)
      if (next && !isNoise(next)) return next
    }
  }
  const candidates: {at: number; line: string}[] = []
  lines.forEach((line, at) => {
    if (isCaret(line)) {
      if (candidates.at(-1)?.at === at - 1) candidates.pop()
    } else if (line && !isLocation(line) && !isNoise(line)) candidates.push({at, line})
  })
  const texts = candidates.map(candidate => candidate.line)
  if (lines.includes('Traceback (most recent call last):')) return texts.toReversed().find(isError) ?? texts.at(-1)
  const first = texts[0]
  if (first === undefined || first.startsWith('Extractor ')) return first
  return texts.find(isError) ?? first
}

/**
 * A failure's message as the panel shows it: what the extractor reported, never the absolute path of the process that
 * ran it (`/…/projections exited with exit status: 1: …`), which an older runner put first; the raw output keeps it.
 */
export function failureMessage(message: string): string {
  const line = reported(message.replace(/^(?:[A-Za-z]:)?[\\/]\S*\s+exited with [^:]+: [^:]+?(?::\s+|$)/, ''))
  if (line !== undefined) return line
  // Nothing after the prefix: the process said nothing, so say which one by its name.
  const program = /^(?:[A-Za-z]:)?[\\/]\S*?([^\\/\s]+)\s+(exited with [^:]+: [^:]+?)(?::\s+|$)/.exec(message)
  return program ? `${program[1]} ${program[2]}` : message.trim()
}
