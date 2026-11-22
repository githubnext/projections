// The icon stories' gallery: each icon drawn by the renderer kit (`Icon`, and `SvgIcon` in an SVG card's status line) and
// by the host's summary bar, at text sizes and large, in panels that each carry one host theme's real tokens.
import {Fragment, useInsertionEffect, useMemo} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import {themeStyle} from '@githubnext/projections-host'
import type {ProjectionController, RendererTheme, SummaryFactTone, SummaryFigure} from '@githubnext/projections-host'
import {svgStatusWidth} from '@githubnext/projections-renderer-kit'
import {Icon, SvgChangeStatus} from '@githubnext/projections-renderer-kit/react'
import type {ChangeClassification, StatusPart} from '@githubnext/projections-renderer-kit'
import type {IconEntry, IconGroup} from './icon-vocabulary.js'
import {IconStyles} from './icon-styles.js'

/** Text sizes, then one large size. */
export const iconSizes = [14, 16, 24, 64] as const

export interface IconPanel {
  id: string
  title: string
  /** The host's theme, as its view root applies it (`themeStyle`). */
  theme: RendererTheme
  /** The host UI's own root around the panel, in the theme's mode. */
  frame: (content: ReactNode) => ReactNode
}

/** The host's summary bar component (the default UI's or the VS Code UI's). */
export type SummaryBarComponent = (props: {projection: ProjectionController; className?: string}) => ReactNode

const tones: Partial<Record<ChangeClassification, SummaryFactTone>> = {added: 'added', removed: 'removed', modified: 'modified'}

type SummaryState = Pick<
  ProjectionController,
  | 'summary'
  | 'comparing'
  | 'variation'
  | 'summaryFilter'
  | 'setSummaryFilter'
  | 'variedOnly'
  | 'setVariedOnly'
  | 'regeneratedOnly'
  | 'setRegeneratedOnly'
  | 'reducedMotion'
>

/** What the summary bar reads of a projection, with one fact: the icon and two of its word, in its change's tone. */
function summaryOf(entry: IconEntry): ProjectionController {
  const word = entry.label.toLowerCase()
  const figure: SummaryFigure = {
    type: 'fact',
    key: `fact:${entry.name}:${entry.label}`,
    noun: entry.noun ?? {singular: word, plural: word},
    kinds: [],
    count: 2,
    added: 0,
    removed: 0,
    modified: 0,
    icon: entry.name,
    tone: tones[entry.status] ?? 'neutral',
  }
  const state: SummaryState = {
    summary: [figure],
    comparing: false,
    variation: undefined,
    summaryFilter: null,
    setSummaryFilter: () => {},
    variedOnly: false,
    setVariedOnly: () => {},
    regeneratedOnly: false,
    setRegeneratedOnly: () => {},
    reducedMotion: true,
  }
  return state as ProjectionController
}

/** The kit's root, as `mountRenderer` creates it in a renderer frame: its aliases of the theme tokens and its type. */
const Kit = ({children}: {children: ReactNode}) => <div className="pk sb-icon-kit">{children}</div>

/** The status line of an SVG card (`SvgChangeStatus`), worded with the icon's part. */
function CardStatus({part}: {part: StatusPart}) {
  const width = Math.ceil(svgStatusWidth([part])) + 16
  return (
    <svg className="sb-icon-card" width={width} height={20} viewBox={`0 0 ${width} 20`} aria-hidden="true">
      <SvgChangeStatus change={{status: 'unchanged'}} emphasis={1} x={0} y={14} parts={[part]} />
    </svg>
  )
}

function IconRow({entry, SummaryBar}: {entry: IconEntry; SummaryBar: SummaryBarComponent}) {
  const part: StatusPart = {status: entry.status, glyph: '', icon: entry.name, label: entry.label}
  const projection = useMemo(() => summaryOf(entry), [entry])
  return (
    <tr data-gallery-icon={entry.name} data-gallery-status={entry.status}>
      <th scope="row">
        <code>{entry.name}</code>
      </th>
      {iconSizes.map(size => (
        <td key={size} className="sb-icon-size">
          <Kit>
            <span className={`pk-status-part ${entry.status}`} style={{fontSize: size}} data-gallery-size={size}>
              <Icon name={entry.name} />
            </span>
          </Kit>
        </td>
      ))}
      <td>
        {/* A card's status footer, as the kit's ChangeFooter draws one part. */}
        <Kit>
          <div className="pk-change-footer">
            <span className="pk-status-text">
              <span className={`pk-status-part ${entry.status}`} data-change-status={entry.status}>
                <Icon name={entry.name} />
                <span className="pk-status-word">{entry.label}</span>
              </span>
            </span>
          </div>
        </Kit>
      </td>
      <td>
        <Kit>
          <CardStatus part={part} />
        </Kit>
      </td>
      <td>
        <SummaryBar projection={projection} className="sb-icon-summary" />
      </td>
    </tr>
  )
}

function IconTable({group, SummaryBar}: {group: IconGroup; SummaryBar: SummaryBarComponent}) {
  return (
    <table className="sb-icon-table" data-gallery-group={group.title}>
      <caption>{group.title}</caption>
      {/* Minimum widths, so the columns of a panel's tables line up unless a word is longer. */}
      <colgroup>
        <col style={{width: 128}} />
        {iconSizes.map(size => (
          <col key={size} style={{width: size + 28}} />
        ))}
        <col style={{width: 168}} />
        <col style={{width: 168}} />
        <col style={{width: 200}} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Icon</th>
          {iconSizes.map(size => (
            <th key={size} scope="col">
              {size}px
            </th>
          ))}
          <th scope="col">Card footer</th>
          <th scope="col">SVG card</th>
          <th scope="col">Summary bar</th>
        </tr>
      </thead>
      <tbody>
        {group.icons.map(entry => (
          <IconRow key={`${entry.name}:${entry.label}`} entry={entry} SummaryBar={SummaryBar} />
        ))}
      </tbody>
    </table>
  )
}

/**
 * The panels' icon tokens on the document root, where a renderer frame has them (the SDK applies its theme to
 * `<html>`) and where the kit's `SvgIcon` resolves them, set before the gallery mounts and removed after. Every
 * panel of a host has the same icons; the colors stay on each panel.
 */
function RootIconTokens({theme, children}: {theme: RendererTheme; children: ReactNode}) {
  // Inserted as styles are, before any layout effect: the kit's `SvgIcon` reads its icon's tokens as it mounts.
  useInsertionEffect(() => {
    const root = document.documentElement
    const icons = Object.entries(theme.tokens).filter(([name]) => name.startsWith('icon-'))
    for (const [name, value] of icons) root.style.setProperty(`--projections-${name}`, value)
    return () => {
      for (const [name] of icons) root.style.removeProperty(`--projections-${name}`)
    }
  }, [theme])
  return children
}

/** Every icon of `groups` in each panel's theme. */
export function IconGallery({groups, panels, SummaryBar}: {groups: IconGroup[]; panels: IconPanel[]; SummaryBar: SummaryBarComponent}) {
  return (
    <IconStyles>
      <RootIconTokens theme={panels[0]!.theme}>
        <div className="sb-icon-panels">
          {panels.map(panel => (
            <Fragment key={panel.id}>
              {panel.frame(
                <section className="sb-icon-panel" style={themeStyle(panel.theme) as CSSProperties} data-icon-panel={panel.id}>
                  <h2>{panel.title}</h2>
                  {groups.map(group => (
                    <IconTable key={group.title} group={group} SummaryBar={SummaryBar} />
                  ))}
                </section>,
              )}
            </Fragment>
          ))}
        </div>
      </RootIconTokens>
    </IconStyles>
  )
}
