import type {CSSProperties} from 'react'
import {identifier, keyed} from '@githubnext/projections-renderer-sdk/presentation'
import {rightX, textX} from './card.js'
import {pillGap, type DiDependencyPiece, type DiSpan, type DiTextLine} from './geometry.js'
import type {DiDependencyChange} from './diff-model.js'

/** Each line's style: the kit graph card's (`node-kind`, `node-label`, `node-detail`), and its own class for its role. */
const lineClass: Record<DiTextLine['role'], string> = {
  contract: 'node-kind di-contract',
  self: 'node-kind di-self',
  implementation: 'node-label di-implementation',
  lifetime: 'node-detail di-lifetime-label',
  note: 'node-detail di-key',
  facet: 'node-field-key di-facet',
}

const toneClass = {was: 'di-was', arrow: 'di-arrow', now: 'di-now'} as const
/** The change hue of a tone's text (the kit's change variables): the old value removed, the new one added. */
const toneHue = {was: 'removed', now: 'added'} as const

/**
 * One line of a diff card's text, from the text column or ending at the card's right inset: code in the monospace
 * font, a changed value's old text struck through and its new text in the added hue.
 */
export function DiLine({line, top, lifetime}: {line: DiTextLine; top: number; lifetime?: string | undefined}) {
  const allCode = line.spans.every(span => span.code)
  const span = (piece: DiSpan, index: number) => {
    const attributes = {
      ...(piece.tone ? {className: toneClass[piece.tone]} : {}),
      ...(piece.tone && piece.tone !== 'arrow' ? {'data-change-hue': toneHue[piece.tone]} : {}),
      ...(piece.code && !allCode ? identifier : {}),
    }
    return Object.keys(attributes).length ? (
      <tspan key={index} {...attributes}>
        {piece.text}
      </tspan>
    ) : (
      piece.text
    )
  }
  return (
    <text
      className={`${lineClass[line.role]} pk-diff-text${line.role === 'lifetime' && lifetime ? ` ${lifetime}` : ''}`}
      x={line.anchor === 'end' ? rightX : textX}
      y={top + line.y}
      {...(line.anchor === 'end' ? {textAnchor: 'end'} : {})}
      {...(allCode ? identifier : {})}
    >
      {line.spans.length === 1 && !line.spans[0]!.tone ? line.spans[0]!.text : line.spans.map(span)}
    </text>
  )
}

/**
 * One line of links a unit gained (+) and lost (−), named after the cards they point at, from the text column; a
 * name too long for a line continues on the next.
 */
export function DependencyLine({
  dependencies,
  pieces,
  y,
  emphasis,
}: {
  dependencies: readonly DiDependencyChange[]
  pieces: readonly DiDependencyPiece[]
  y: number
  emphasis: (id: string) => number
}) {
  return (
    <text className="di-dependencies" x={textX} y={y}>
      <title>{dependencies.map(item => `${item.change === 'added' ? '+' : '−'} ${item.name}`).join(', ')}</title>
      {keyed(pieces, piece => dependencies[piece.index]?.key ?? piece.text).map(([key, piece], index) => {
        const dependency = dependencies[piece.index]!
        return (
          <tspan
            key={key}
            className="di-dependency"
            data-change={dependency.change}
            dx={index ? pillGap : 0}
            style={{'--emphasis': emphasis(dependency.id)} as CSSProperties}
          >
            {piece.sign && <tspan className="di-dependency-sign">{dependency.change === 'added' ? '+ ' : '− '}</tspan>}
            <tspan className="di-dependency-name" {...identifier}>
              {piece.text}
            </tspan>
          </tspan>
        )
      })}
    </text>
  )
}
