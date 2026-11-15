import {
  cardFooterHeight,
  cardHeight,
  cardTextMetrics,
  diffCardMetrics,
  layerGap,
  trackSpacing,
  wrapText,
} from '@githubnext/projections-renderer-kit'

/*
 * Card geometry shared by the model's layouts and the cards that draw them,
 * and diff mode's card text, laid out whole on as many lines as it needs.
 */

/**
 * Card geometry, in card units: a kit graph card's (see the kit's `cardHeight` and `cardTextMetrics`), wider for
 * type names. `body` holds the registration, `footer` is the band under it reserved for change status, so a card
 * never resizes when status shows. `rowGap` is the kit's `layerGap` and two tracks more: room between rows for an
 * arrow's tail, two full turns and its arrowhead's lead-in, with up to three arrows' runs side by side (see the kit's
 * `trackSpacing`).
 */
export const diMetrics = {
  width: 264,
  height: cardHeight('service'),
  body: cardHeight('service') - cardFooterHeight,
  footer: cardFooterHeight,
  columnGap: 56,
  rowGap: layerGap + 2 * trackSpacing,
}

/** A transition card's height: a kit graph card's, which reserves its status footer only in a comparison. */
export function diCardHeight(comparing: boolean): number {
  return cardHeight('service', comparing)
}

export const halfWidth = diMetrics.width / 2
export const halfHeight = diMetrics.height / 2
/** Where text starts and ends, from the card's centre: after the lifetime mark (`lifetimeMark`), and the kit card's inset at the right. */
export const textX = -halfWidth + 27
export const rightX = halfWidth - cardTextMetrics.inset
/** Baselines from the card's top: the kind line (the contract and the lifetime), then the implementation under it. */
export const kindBaseline = cardTextMetrics.firstBaseline
export const labelBaseline = cardTextMetrics.labelBaseline
/** Where the kind line's part of the card ends and the implementation's begins, from the card's top. */
export const headerHeight = kindBaseline + (labelBaseline - kindBaseline) / 2 - 3

/**
 * Approximate advance per character, in card units, of each card text style at the type scale's default size
 * (`font-size-xs`), so text stops before it reaches the text beside it: type names, keys and scope names are
 * identifiers, drawn in the monospace font; the lifetime and other words in sans.
 */
export const advance = {
  contract: cardTextMetrics.monoAdvance,
  implementation: cardTextMetrics.monoAdvance,
  lifetime: cardTextMetrics.proseAdvance,
  key: cardTextMetrics.monoAdvance,
}
export const textGap = cardTextMetrics.detailGap
/** The kind line of a card registered as its own type, in words. */
export const selfRegistered = 'Self-registered'

/** Height of one line of a diff card's text: the kit diff card's (`diffCardMetrics.line`). */
export const diLineHeight = diffCardMetrics.line
/** Width a line of text may use: the card's less its text inset on each side. */
export const lineRoom = rightX - textX
/** Approximate advance of human and monospace text at `font-size-xs`, in card units. */
export const sansAdvance = cardTextMetrics.proseAdvance
export const monoAdvance = cardTextMetrics.monoAdvance
/** Space between two dependencies on a change line. */
export const pillGap = 10

/**
 * The registration's part of a card: the top right, holding the lifetime label `width` card units wide (and the gap
 * beside it), as tall as the kind line.
 */
export function registrationWidth(width: number): number {
  // Whole card units, so the part's edge falls on a pixel at whole zooms and its tint meets its neighbours' cleanly.
  return Math.ceil(width + cardTextMetrics.inset + textGap / 2)
}

const charsIn = (width: number, perChar: number) => Math.max(1, Math.floor(width / perChar + 1e-9))

/** A tone a span of diff card text takes: an old value struck through, the arrow, then the new value. */
export type DiTone = 'was' | 'arrow' | 'now'

/** A run of a line of a diff card's text: monospace when it is code, in its tone when it is part of a change. */
export interface DiSpan {
  text: string
  code: boolean
  tone?: DiTone | undefined
}

/** One line of a diff card's text; `y` is its baseline, in card units from the card's top. */
export interface DiTextLine {
  role: 'contract' | 'self' | 'implementation' | 'lifetime' | 'note' | 'facet'
  /** Where the line is anchored: at the text's start, or its end at the card's right inset. */
  anchor: 'start' | 'end'
  y: number
  spans: DiSpan[]
}

export type DiFacetPart = 'key' | 'was' | 'arrow' | 'now'
export interface DiFacetPiece {
  part: DiFacetPart
  text: string
}
/** Part of a dependency on a change line: the dependency's index, and whether this piece starts it (with its sign). */
export interface DiDependencyPiece {
  index: number
  sign: boolean
  text: string
}

/** A box in card units from the card's top-left corner. */
export interface DiPartBox {
  x: number
  y: number
  width: number
  height: number
}

/** A diff card's text, laid out whole: long values wrap onto more lines and the card grows to hold them. */
export interface DiCardText {
  /** The card's height: its text, then the status footer. At least a transition card's. */
  height: number
  lines: DiTextLine[]
  /** Where the kind line's part ends and the implementation's begins, from the card's top. */
  split: number
  /** The registration's part of the card (the lifetime), in card units from its top-left corner. */
  registration: DiPartBox
  /** Where the lifetime mark ends, from the card's top: the last name line's baseline. */
  markBottom: number
  /** The lines listing the links the unit gained and lost: each line's baseline and pieces. */
  dependencies: {y: number; pieces: DiDependencyPiece[]}[]
}

export interface DiCardTextInput {
  contract?: string | undefined
  implementation: string
  /** The lifetime label in each revision; a changed one shows both. */
  lifetime: {before?: string | undefined; after: string; code: boolean}
  /** The implementation in Before, when it changed. */
  implementationBefore?: string | undefined
  note?: {text: string; prefix?: string | undefined; code: boolean} | undefined
  /** Other changed facets, each listed under the name: its name, then both values. */
  facets: readonly {key: string; before: string; after: string; identifier: boolean}[]
  dependencies: readonly {name: string}[]
}

/** A line that ends after one of the characters `wrapText` prefers to break after. */
const breakable = /[_./\-,:\s]$/

/**
 * Runs of text flowed onto lines `width` wide: a run that doesn't fit what's
 * left of a line starts the next one; a wrapping run longer than a whole line
 * fills what's left (when that's a fair share and it can break there after a
 * `_ . / - , :` or space) and continues on the next, broken by `wrapText`.
 * Nothing is dropped; spaces at a line's start are.
 */
export function flowRuns<P>(runs: readonly {part: P; text: string; advance: number; wrap: boolean}[], width: number) {
  const lines: {part: P; text: string}[][] = [[]]
  let x = 0
  for (const run of runs) {
    let text = run.text
    while (text) {
      if (x === 0) text = text.trimStart()
      if (!text) break
      const free = Math.floor((width - x) / run.advance + 1e-9)
      const full = Math.floor(width / run.advance + 1e-9)
      if (text.trimEnd().length <= free) {
        lines.at(-1)!.push({part: run.part, text})
        x += text.length * run.advance
        break
      }
      if (x > 0 && (!run.wrap || text.trimEnd().length <= full || free < full / 3)) {
        lines.push([])
        x = 0
        continue
      }
      if (!run.wrap) {
        lines.at(-1)!.push({part: run.part, text})
        x += text.length * run.advance
        break
      }
      const head = wrapText(text, Math.max(1, free))[0]!
      // Text sharing a line with earlier runs breaks only where it reads well; otherwise it starts the next line.
      if (x > 0 && !breakable.test(head)) {
        lines.push([])
        x = 0
        continue
      }
      lines.at(-1)!.push({part: run.part, text: head})
      text = text.slice(head.length)
      lines.push([])
      x = 0
    }
  }
  return lines.filter(line => line.length)
}

/** A facet change, flowed whole: its name, the old value (struck through), the arrow, then the new value. */
export function facetLines(facet: DiCardTextInput['facets'][number]): DiFacetPiece[][] {
  const value = facet.identifier ? monoAdvance : sansAdvance
  return flowRuns<DiFacetPart>(
    [
      {part: 'key', text: `${facet.key} `, advance: sansAdvance, wrap: false},
      {part: 'was', text: facet.before, advance: value, wrap: true},
      {part: 'arrow', text: ' → ', advance: sansAdvance, wrap: false},
      {part: 'now', text: facet.after, advance: value, wrap: true},
    ],
    lineRoom,
  )
}

/** Links gained and lost, each whole (its sign and the name it points at) on as few lines as fit; a name longer than a line wraps. */
export function dependencyLines(dependencies: DiCardTextInput['dependencies']): DiDependencyPiece[][] {
  const lines: DiDependencyPiece[][] = [[]]
  const sign = 2 * monoAdvance
  let x = 0
  dependencies.forEach((dependency, index) => {
    const width = sign + dependency.name.length * monoAdvance
    if (x > 0 && x + pillGap + width > lineRoom) {
      lines.push([])
      x = 0
    }
    if (width <= lineRoom || x > 0) {
      lines.at(-1)!.push({index, sign: true, text: dependency.name})
      x += (x > 0 ? pillGap : 0) + width
      return
    }
    // A name too long for a line continues, centred, on the next; only its first piece has the sign.
    const pieces = wrapText(dependency.name, Math.floor((lineRoom - sign) / monoAdvance + 1e-9))
    pieces.forEach((text, piece) => {
      if (piece) lines.push([])
      lines.at(-1)!.push({index, sign: piece === 0, text})
    })
    x = (pieces.length > 1 ? 0 : sign) + pieces.at(-1)!.length * monoAdvance
  })
  return lines.filter(line => line.length)
}

/** The width of spans of text, in card units. */
const spansWidth = (spans: readonly DiSpan[]) =>
  spans.reduce((sum, span) => sum + span.text.length * (span.code ? monoAdvance : sansAdvance), 0)

/** A value that changed, on one line: the old one struck through, an arrow, then the new one. */
const inlineChange = (before: string, after: string, code: boolean): DiSpan[] => [
  {text: before, code, tone: 'was'},
  {text: ' → ', code: false, tone: 'arrow'},
  {text: after, code, tone: 'now'},
]

/** A change too long for one line: the old value's lines, then the new value's after an arrow (the kit's diff cards). */
function changeLines(before: string, after: string, code: boolean): DiSpan[][] {
  const chars = charsIn(lineRoom, code ? monoAdvance : sansAdvance)
  return [
    ...wrapText(before, chars).map((text): DiSpan[] => [{text, code, tone: 'was'}]),
    ...wrapText(`→ ${after}`, chars).map((text, index): DiSpan[] =>
      index === 0
        ? [
            {text: '→ ', code: false, tone: 'arrow'},
            {text: text.slice(2), code, tone: 'now'},
          ]
        : [{text, code, tone: 'now'}],
    ),
  ]
}

/**
 * A diff card's text, whole, in a kit graph card's places (see the kit's `diffCardText`): the kind line (the contract,
 * or `Self-registered`) with the lifetime at its right, which shows both values when it changed, then the
 * implementation (struck through, then the new one, when it changed) with the key or note at its right. Text that
 * doesn't fit beside other text takes lines of its own, and long names wrap. Below come the other changed facets and
 * the links the unit gained and lost; the card grows to hold them, above its status footer. Text that fits keeps the
 * transition card's exact places.
 */
export function diCardText(input: DiCardTextInput): DiCardText {
  const lines: DiTextLine[] = []
  let y = kindBaseline - diLineHeight
  const next = (gap = 0) => (y += diLineHeight + gap)
  const push = (role: DiTextLine['role'], spans: DiSpan[], anchor: DiTextLine['anchor'] = 'start', at = next()) =>
    lines.push({role, anchor, y: at, spans})

  // The kind line, with the lifetime at its right when it fits there.
  const contract = input.contract !== undefined
  const kind = wrapText(input.contract ?? selfRegistered, charsIn(lineRoom, contract ? monoAdvance : sansAdvance))
  for (const text of kind) push(contract ? 'contract' : 'self', [{text, code: contract}])
  const {before, after, code} = input.lifetime
  const changed = before !== undefined && before !== after
  const lifetime = changed ? inlineChange(before, after, code) : [{text: after, code}]
  const lifetimeWidth = spansWidth(lifetime)
  const beside = spansWidth([{text: kind.at(-1)!, code: contract}]) + textGap + lifetimeWidth <= lineRoom
  const kindEnd = y
  if (beside) push('lifetime', lifetime, 'end', y)
  else if (changed && lifetimeWidth <= lineRoom) push('lifetime', lifetime)
  else if (changed) for (const spans of changeLines(before, after, code)) push('lifetime', spans)
  else for (const text of wrapText(after, charsIn(lineRoom, code ? monoAdvance : sansAdvance))) push('lifetime', [{text, code}])
  const split = y + (labelBaseline - kindBaseline) / 2 - 3
  const registration = beside
    ? {x: diMetrics.width - registrationWidth(lifetimeWidth), y: 0, width: registrationWidth(lifetimeWidth), height: split}
    : {x: 0, y: kindEnd + diLineHeight / 2 - 3, width: diMetrics.width, height: split - (kindEnd + diLineHeight / 2 - 3)}

  // The implementation, with the key or note at the right of its first line when it fits there.
  const chars = charsIn(lineRoom, monoAdvance)
  // A changed name shows the old one struck through above the new one, as the kit's diff cards do.
  const renamed = input.implementationBefore !== undefined && input.implementationBefore !== input.implementation
  const names: DiSpan[][] = [
    ...(renamed ? wrapText(input.implementationBefore!, chars).map((text): DiSpan[] => [{text, code: true, tone: 'was'}]) : []),
    ...wrapText(input.implementation, chars).map((text): DiSpan[] => [{text, code: true, ...(renamed ? {tone: 'now' as const} : {})}]),
  ]
  const note: DiSpan[] | undefined = input.note
    ? [...(input.note.prefix ? [{text: input.note.prefix, code: false}] : []), {text: input.note.text, code: input.note.code}]
    : undefined
  names.forEach((spans, index) => push('implementation', spans, 'start', next(index === 0 ? diffCardMetrics.labelGap : 0)))
  const firstName = lines.find(line => line.role === 'implementation')!
  if (note && names.length === 1 && spansWidth(firstName.spans) + textGap + spansWidth(note) <= lineRoom)
    push('note', note, 'end', firstName.y)
  else if (note) {
    // Under the name, wrapped: the prefix stays in words on the first line.
    const prefix = note[1] ? note[0]! : undefined
    const value = note.at(-1)!
    wrapText(`${prefix?.text ?? ''}${value.text}`, charsIn(lineRoom, value.code ? monoAdvance : sansAdvance)).forEach((text, index) =>
      push(
        'note',
        index === 0 && prefix && text.startsWith(prefix.text)
          ? [prefix, {text: text.slice(prefix.text.length), code: value.code}]
          : [{text, code: value.code}],
      ),
    )
  }

  // The other facets that changed, then the links the unit gained and lost.
  input.facets.forEach((facet, index) =>
    facetLines(facet).forEach((pieces, line) =>
      push(
        'facet',
        pieces.map(piece => ({
          text: piece.text,
          code: facet.identifier && (piece.part === 'was' || piece.part === 'now'),
          ...(piece.part === 'key' ? {} : {tone: piece.part}),
        })),
        'start',
        next(index === 0 && line === 0 ? diffCardMetrics.fieldsGap : 0),
      ),
    ),
  )
  const dependencies = dependencyLines(input.dependencies).map((pieces, index) => ({
    y: next(index === 0 ? diffCardMetrics.fieldsGap : 0),
    pieces,
  }))
  return {
    height: Math.max(diMetrics.height, y + diffCardMetrics.bottom + diMetrics.footer),
    lines,
    split,
    registration,
    markBottom: Math.max(...lines.filter(line => line.role === 'implementation').map(line => line.y)),
    dependencies,
  }
}

/** A box in content units, by its top-left corner. */
export interface DiBox {
  x: number
  y: number
  width: number
  height: number
}
