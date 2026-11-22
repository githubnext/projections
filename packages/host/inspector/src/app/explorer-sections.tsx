import type {Dispatch, ReactNode, SetStateAction} from 'react'
import type {Definition} from '@githubnext/projections-schemas'
import {Button, Checkbox, Input, cn} from '@githubnext/projections-host/ui/components'
import {ArrowLeftRight, FlaskConical, GitCompareArrows, Plus, Square, X} from 'lucide-react'
import type {InspectorApi} from '../client/api.js'
import {ChoiceButton, RefField} from '../compare.js'
import {PartsPanel} from '../parts/panel.js'
import {overriddenDefinition, type DefinitionWriter, type PartOverrides, type PartRow} from '../parts/model.js'
import {iconButton, shortcutLabel} from '../shell/controls.js'
import {ExplorerSubheading, type ExplorerSection} from '../shell/explorer.js'
import type {InspectorPairs, InspectorRevision, InspectorScenario} from '../types.js'
import type {Artifact} from './artifacts.js'
import {errorText} from './errors.js'
import {pairLabel, suggestedPairs, type Marks} from './pairs.js'
import {RevisionItem} from './revision-item.js'
import {workingTree, type RevisionRow, type RowState} from './revisions.js'

/** A titled section of the Inspector's sidebar, named by `title` for assistive technology, with header `actions`. */
export function SidebarSection({title, actions, children}: {title: string; actions?: ReactNode; children: ReactNode}) {
  return (
    <section aria-label={title} className="pj:flex pj:min-h-0 pj:flex-col pj:gap-1">
      <div className="pj:flex pj:h-7 pj:items-center pj:gap-1 pj:px-1.5">
        <h2 className="pj:min-w-0 pj:flex-1 pj:truncate pj:text-[11px] pj:font-semibold pj:text-muted-foreground">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

/**
 * The Explorer's sections. With a runner: Parts (the projection's extractor, comparator and renderer) and Compare
 * (the Before → After pair, suggested pairs, renderer scenarios and History), then a saved artifact's extractions.
 * Without one: the saved artifact, or how to open one.
 */
export function explorerSections({
  api,
  projection,
  marked,
  pairsHere,
  revisions,
  recent,
  revisionRows,
  projectionRows,
  showing,
  before,
  after,
  setMark,
  extract,
  runnable,
  artifact,
  setArtifact,
  artifactMarks,
  setSource,
  canSwap,
  swap,
  ownDefinition,
  allDefinitions,
  overrides,
  partRows,
  resetParts,
  writer,
  setPanelRequest,
  loading,
  busy,
  cancel,
  toggleOne,
  choosePair,
  scenarios,
  shownScenario,
  showScenario,
  newRef,
  setNewRef,
  setAdded,
}: {
  api: InspectorApi | undefined
  projection: string
  marked: Marks
  pairsHere: InspectorPairs | null | undefined
  revisions: readonly InspectorRevision[]
  recent: Record<string, Marks[]>
  revisionRows: readonly RevisionRow[]
  projectionRows: Record<string, RowState>
  showing: 'live' | 'artifact'
  before: string
  after: string | undefined
  setMark: (letter: 'A' | 'B', key: string, artifactRow: boolean) => void
  extract: (refs: readonly string[], keep?: boolean) => void
  runnable: boolean
  artifact: Artifact | null
  setArtifact: Dispatch<SetStateAction<Artifact | null>>
  artifactMarks: Marks
  setSource: Dispatch<SetStateAction<'live' | 'artifact'>>
  canSwap: boolean
  swap: () => void
  ownDefinition: Definition | undefined
  allDefinitions: readonly Definition[]
  overrides: Record<string, PartOverrides>
  partRows: PartRow[]
  resetParts: () => void
  writer: DefinitionWriter | undefined
  setPanelRequest: Dispatch<SetStateAction<{tab: string; at: number} | undefined>>
  loading: boolean
  busy: boolean
  cancel: () => Promise<void>
  toggleOne: (one: boolean) => void
  choosePair: (pair: Marks) => void
  scenarios: readonly InspectorScenario[]
  shownScenario: string | undefined
  showScenario: (id: string) => void
  newRef: string
  setNewRef: Dispatch<SetStateAction<string>>
  setAdded: Dispatch<SetStateAction<string[]>>
}): ExplorerSection[] {
  const validateRef = async (ref: string) => {
    if (!api || ref === workingTree) return
    try {
      await api.definitions(ref)
    } catch (failure) {
      throw new Error(`Not a revision here: ${ref} (${errorText(failure)})`, {cause: failure})
    }
  }
  const one = !marked.a
  const pairSuggestions = suggestedPairs(pairsHere, revisions, recent[projection] ?? [])
  const historyRow = (row: RevisionRow) => (
    <RevisionItem
      key={row.ref}
      row={row}
      state={projectionRows[row.ref]}
      mark={showing === 'live' ? (marked.a === row.ref ? 'A' : marked.b === row.ref ? 'B' : undefined) : undefined}
      selected={showing === 'live' && (row.ref === before || row.ref === after)}
      onMark={letter => setMark(letter, row.ref, false)}
      onExtract={() => extract([row.ref])}
      disabled={!runnable || projectionRows[row.ref]?.status === 'running' || projectionRows[row.ref]?.status === 'queued'}
    />
  )
  const artifactSection: ExplorerSection | undefined = artifact
    ? {
        id: 'artifact',
        title: `Saved · ${artifact.name}`,
        actions: api ? (
          <button
            type="button"
            className={cn(iconButton, 'pj:h-6 pj:w-6')}
            aria-label="Close artifact"
            onClick={() => {
              setArtifact(null)
              setSource('live')
            }}
          >
            <X className="pj:h-3.5 pj:w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(iconButton, 'pj:h-6 pj:w-6')}
            aria-label="Swap Before and After"
            title={`Swap Before and After (${shortcutLabel('i')})`}
            disabled={!canSwap}
            onClick={swap}
          >
            <ArrowLeftRight className="pj:h-3.5 pj:w-3.5" />
          </button>
        ),
        children: (
          <ul className="pj:flex pj:flex-col">
            {artifact.choices.map(choice => (
              <RevisionItem
                key={choice.key}
                row={{ref: choice.key, label: choice.label, detail: choice.document.digest.slice(0, 19)}}
                state={{status: 'done', document: choice.document}}
                selected={showing === 'artifact' && (choice.key === before || choice.key === after)}
                mark={
                  showing === 'artifact'
                    ? artifactMarks.a === choice.key
                      ? 'A'
                      : artifactMarks.b === choice.key
                        ? 'B'
                        : undefined
                    : undefined
                }
                onMark={letter => setMark(letter, choice.key, true)}
              />
            ))}
          </ul>
        ),
      }
    : undefined
  return api
    ? [
        {
          id: 'parts',
          title: 'Parts',
          children: ownDefinition ? (
            <PartsPanel
              rows={partRows}
              definition={ownDefinition}
              saved={overriddenDefinition(ownDefinition, overrides[projection], allDefinitions)}
              onDiagnostics={() => setPanelRequest({tab: 'diagnostics', at: Date.now()})}
              onResetAll={resetParts}
              writer={writer}
            />
          ) : (
            <p className="pi-x-block pj:py-1 pj:text-xs pj:text-muted-foreground">
              {loading ? 'Reading definitions…' : 'No projection definitions'}
            </p>
          ),
        },
        {
          id: 'compare',
          title: 'Compare',
          actions: busy ? (
            <button
              type="button"
              className={cn(iconButton, 'pj:h-6 pj:w-6')}
              aria-label="Cancel extraction"
              title="Cancel extraction"
              onClick={() => void cancel()}
            >
              <Square className="pj:h-3 pj:w-3" />
            </button>
          ) : undefined,
          children: (
            <>
              <div className="pi-compare pj:flex pj:flex-col pj:gap-2">
                <label htmlFor="pi-show-one" className="pi-x-block pj:flex pj:min-h-6 pj:items-center pj:gap-1.5 pj:text-xs">
                  <Checkbox
                    id="pi-show-one"
                    checked={one}
                    disabled={!projection || !marked.b}
                    onCheckedChange={value => toggleOne(value === true)}
                    aria-label="Show one revision"
                  />
                  Show one revision
                </label>
                {showing === 'artifact' && shownScenario && (
                  <p className="pi-x-block pj:text-[11px] pj:text-muted-foreground">
                    Showing a renderer scenario.{' '}
                    <button type="button" className="pj:underline pj:underline-offset-2" onClick={() => setSource('live')}>
                      Back to {pairLabel(marked)}
                    </button>
                  </p>
                )}
                <div className="pi-x-block pj:flex pj:items-start pj:gap-1">
                  {one ? (
                    <RefField
                      label="Revision"
                      value={marked.b}
                      disabled={!projection}
                      validate={validateRef}
                      onApply={ref => choosePair({b: ref})}
                    />
                  ) : (
                    <>
                      <RefField
                        label="Before"
                        value={marked.a}
                        disabled={!projection}
                        validate={validateRef}
                        onApply={ref => choosePair({a: ref, b: ref === marked.b ? marked.a : marked.b})}
                      />
                      <button
                        type="button"
                        className={cn(iconButton, 'pj:mt-[18px] pj:h-7 pj:w-7')}
                        aria-label="Swap Before and After"
                        title={`Swap Before and After (${shortcutLabel('i')})`}
                        disabled={!canSwap}
                        onClick={swap}
                      >
                        <ArrowLeftRight className="pj:h-3.5 pj:w-3.5" />
                      </button>
                      <RefField
                        label="After"
                        value={marked.b}
                        disabled={!projection}
                        validate={validateRef}
                        onApply={ref => choosePair({a: ref === marked.a ? marked.b : marked.a, b: ref})}
                      />
                    </>
                  )}
                </div>
              </div>
              <ExplorerSubheading>Pairs</ExplorerSubheading>
              <ul aria-label="Pairs" className="pj:flex pj:flex-col">
                {pairSuggestions.map(({pair: suggestion, detail, title: named}) => (
                  <li key={`${suggestion.a}→${suggestion.b}`}>
                    <ChoiceButton
                      aria-label={`Compare ${pairLabel(suggestion)}`}
                      pressed={showing === 'live' && marked.a === suggestion.a && marked.b === suggestion.b}
                      icon={<GitCompareArrows />}
                      label={named ?? pairLabel(suggestion)}
                      detail={named ? `${detail} · ${pairLabel(suggestion)}` : detail}
                      onClick={() => choosePair(suggestion)}
                      data-pair={`${suggestion.a}→${suggestion.b}`}
                    />
                  </li>
                ))}
              </ul>
              {scenarios.length > 0 && (
                <>
                  <ExplorerSubheading>Renderer scenarios</ExplorerSubheading>
                  <ul aria-label="Renderer scenarios" className="pj:flex pj:flex-col">
                    {scenarios.map(scenario => (
                      <li key={scenario.id}>
                        <ChoiceButton
                          pressed={shownScenario === scenario.id}
                          icon={<FlaskConical />}
                          label={scenario.title}
                          detail={
                            scenario.error
                              ? `Invalid: ${scenario.error}`
                              : (scenario.description ?? (scenario.before ? 'A comparison' : 'One revision'))
                          }
                          title={scenario.error ?? scenario.description}
                          onClick={() => showScenario(scenario.id)}
                          data-scenario={scenario.id}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <ExplorerSubheading>History</ExplorerSubheading>
              <ul aria-label="History" className="pj:flex pj:flex-col">
                {revisionRows.map(historyRow)}
              </ul>
              <form
                className="pi-x-block pj:mt-1 pj:flex pj:items-center pj:gap-1"
                onSubmit={event => {
                  event.preventDefault()
                  const ref = newRef.trim()
                  if (!ref) return
                  setAdded(current => (current.includes(ref) ? current : [...current, ref]))
                  setNewRef('')
                  extract([ref])
                }}
              >
                <Input
                  aria-label="Any ref"
                  placeholder="+ any ref (branch, tag, SHA)"
                  value={newRef}
                  onChange={event => setNewRef(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="pj:h-7 pj:font-mono pj:text-xs pj:md:text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="pj:h-7 pj:px-2"
                  disabled={!runnable || !newRef.trim()}
                  aria-label="Add and extract ref"
                  title="Add and extract"
                >
                  <Plus />
                </Button>
              </form>
            </>
          ),
        },
        ...(artifactSection ? [artifactSection] : []),
      ]
    : [
        ...(artifactSection ? [artifactSection] : []),
        ...(artifact
          ? []
          : [
              {
                id: 'offline',
                title: 'Artifacts',
                children: (
                  <p className="pi-x-block pj:py-1 pj:text-xs pj:text-muted-foreground">
                    No runner is connected. Open a saved extraction or comparison; no extractor code will execute.
                  </p>
                ),
              },
            ]),
      ]
}
