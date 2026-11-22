import {useCallback, useMemo, useState} from 'react'
import {LoadingStatus, ProjectionView} from '@githubnext/projections-host/ui'
import {createControllerStore} from '../details.js'
import {useInspectorHost} from '../host.js'
import type {PartOverrides} from '../parts/model.js'
import {Explorer} from '../shell/explorer.js'
import {useTheme} from '../shell/theme.js'
import {projectionTrust} from './definitions.js'
import {explorerSections} from './explorer-sections.js'
import {InspectorBody} from './inspector-body.js'
import {mentionsPath} from './page.js'
import type {Marks} from './pairs.js'
import {inspectorPanelTabs} from './panel-tabs.js'
import {pairRunning, pairSides, projectionStatus, switcherModel, switcherStatusOf, trustStateOf, viewNotices} from './projection-status.js'
import type {InspectorAppProps} from './props.js'
import {limitations, workingTree} from './revisions.js'
import {InspectorStatus} from './status-items.js'
import {inspectorTitleBar} from './title-bar.js'
import {useArtifacts} from './use-artifacts.js'
import {useCommands} from './use-commands.js'
import {useComparison} from './use-comparison.js'
import {useExtractedPair} from './use-extracted-pair.js'
import {useExtractions} from './use-extractions.js'
import {useInspectorHandle} from './use-inspector-handle.js'
import {useLiveChanges} from './use-live-changes.js'
import {usePairSelection} from './use-pair-selection.js'
import {useParts} from './use-parts.js'
import {usePresentedPair} from './use-presented-pair.js'
import {useFirstDefinition, useRepository} from './use-repository.js'
import {useScenarios} from './use-scenarios.js'
import {BareFrame, InspectorWorkbench} from './workbench.js'

/**
 * The Inspector for a repository (or, without a runner, for saved artifacts):
 * extract revisions from the sidebar, mark two as A and B, and compare them
 * in this browser with the projection's comparator.
 */
export function InspectorApp({
  api,
  engine,
  loadArtifact,
  initialDocument,
  renderers,
  rules,
  customRendererBase,
  onOpen: openProp,
  handleRef,
  projectionView: View = ProjectionView,
  loadingStatus: Loading = LoadingStatus,
  initial: openedInitially,
  chrome = 'workbench',
  banner,
  aside,
  toolbarStart,
  utilityArea = false,
  refresh = 'auto',
  initialResults,
  definitionRevision: openedDefinitionRevision,
}: InspectorAppProps) {
  const theme = useTheme()
  const host = useInspectorHost()
  const onOpen = useMemo(
    () => openProp ?? (host.openFile ? (path: string, line?: number) => host.openFile!(path, line) : undefined),
    [openProp, host],
  )
  const [error, setError] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState('diagnostics')
  const [panelRequest, setPanelRequest] = useState<{tab: string; at: number}>()
  const [added, setAdded] = useState<string[]>([])
  const [newRef, setNewRef] = useState('')
  const [marks, setMarks] = useState<Record<string, Marks>>({})
  // Session overrides of each projection's parts; the definition file stays the source of truth.
  const [overrides, setOverrides] = useState<Record<string, PartOverrides>>({})
  const [setupDismissed, setSetupDismissed] = useState(false)
  // The title bar's projection switcher, and the presented view's controller for the docked Details panel.
  const [switcher, setSwitcher] = useState(false)
  const [controllers] = useState(createControllerStore)
  const {artifact, setArtifact, artifactMarks, setArtifactMarks, source, setSource, loadingArtifact, upload, openArtifact} = useArtifacts({
    initialDocument,
    loadArtifact,
    setError,
  })
  const {
    definitions,
    revisions,
    setRevisions,
    projection,
    setProjection,
    definitionRevision,
    lists,
    loading,
    connected,
    repoKey,
    refreshDefinitions,
    chooseDefinition,
    definitionOptions,
  } = useRepository({api, openedInitially, openedDefinitionRevision, setError})

  const {policy, extractorFrom, runPolicy, rendererPolicy, usesOwnRenderer, authorized, trusted, needsTrust, runCommand} = projectionTrust(
    definitions ?? undefined,
    projection,
    overrides[projection],
  )
  const runnable = Boolean(api && definitions && projection) && (!runPolicy.requiresTrust || (authorized && trusted))
  const {jobs, rows, setRows, dropQueued, active, extracted, forgetExtracted, extract, cancel, busy} = useExtractions({
    api,
    projection,
    definitionRevision,
    extractorFrom,
    runnable,
    definitions,
    marks,
    setError,
    setPanelRequest,
    openedInitially,
    initialResults,
  })

  const marked = useMemo(() => marks[projection] ?? {}, [marks, projection])
  const {revisionRows, projectionRows, showing, choices, before, after, switching} = usePresentedPair({
    api,
    revisions,
    added,
    marked,
    projection,
    rows,
    overrides,
    definitions,
    source,
    artifact,
    artifactMarks,
    runnable,
    definitionRevision,
  })
  const {pair, comparison, builtins, setRendererVersions} = useComparison({
    api,
    engine,
    rules,
    renderers,
    customRendererBase,
    rows,
    definitionRevision,
    overrides,
    lists,
    authorized,
    trusted,
    // Nothing to compare until a pair is shown (`usePresentedPair`): the view shows its loading state, not one side.
    choices: after ? choices : [],
    before,
    after,
  })

  // The projection's code always comes from the working tree (unless the advanced Definition from says otherwise);
  // the data axis is the Before → After pair. Both sides are extracted as soon as the projection can run, again with
  // a new definition revision, and (see the changes loop) whenever the projection's code changes.
  const live = Boolean(api) && definitionRevision === workingTree
  const paired = Boolean(api && projection && marks[projection])
  useExtractedPair({runnable, projection, paired, marked, rows, setRows, definitionRevision, extract, extracted})
  const {setMark, swap, canSwap, pairsHere, projectionDefault, recent, choosePair, switchProjection, toggleOne} = usePairSelection({
    api,
    projection,
    setProjection,
    repoKey,
    revisions,
    marks,
    setMarks,
    marked,
    openedInitially,
    showing,
    before,
    after,
    setArtifactMarks,
    setSource,
  })
  useFirstDefinition({definitions, setProjection, setSource})
  const {scenarios, shownScenario, showScenario, requestScenario, setScenarioVersions} = useScenarios({
    api,
    projection,
    known: Boolean(definitions),
    live,
    policy,
    showing,
    artifact,
    setError,
    setPanelRequest,
    setArtifact,
    setArtifactMarks,
    setSource,
  })
  const {watching, replay} = useLiveChanges({
    api,
    refresh,
    forgetExtracted,
    setRows,
    setRevisions,
    setRendererVersions,
    setScenarioVersions,
    live,
    runnable,
    projection,
    rows,
    revisions,
    marked,
    extract,
    refreshDefinitions,
    retry: pair.retry,
    definitionRevision,
  })

  const job = jobs.at(-1)
  // The shown pair's sides, and those that failed.
  const sides = pairSides(marked)
  const failedSides = showing === 'live' ? sides.filter(item => projectionRows[item.ref]?.status === 'failed') : []
  const diagnostics = useMemo(() => [...(job?.diagnostics ?? []), ...limitations(choices)], [job, choices])
  const labelOf = (key: string | undefined) => choices.find(choice => choice.key === key)?.label
  const lastTiming = Object.values(projectionRows)
    .filter(state => state.status === 'done' && state.ms !== undefined && state.ms !== 0)
    .at(-1)?.ms

  const statusOf = useCallback((id: string) => projectionStatus(marks, rows, id), [marks, rows])
  const running = pairRunning(Boolean(showing === 'live' && projection && (switching || statusOf(projection)?.kind === 'extracting')), pair)
  const switcherStatus = (id: string) => switcherStatusOf(statusOf(id), definitions, id)
  const switcherList = switcherModel({
    connected: Boolean(api),
    definitions,
    artifact,
    projection,
    document: pair.document,
    status: switcherStatus,
  })
  const {allDefinitions, ownDefinition, resetParts, writer, partRows} = useParts({
    api,
    projection,
    definitions,
    definitionRevision,
    authorized,
    overrides,
    setOverrides,
    setRows,
    refreshDefinitions,
    builtins,
    pair,
    policy,
    statusOf,
    usesOwnRenderer,
    rendererPolicy,
  })
  const commands = useCommands({
    host,
    showing,
    api,
    runnable,
    extract,
    projection,
    marked,
    busy,
    cancel,
    refreshDefinitions,
    definitionRevision,
    definitionOptions,
    chooseDefinition,
    partRows,
    resetParts,
    definitions,
    switchProjection,
    switcherCount: switcherList.items.length,
    projectionDefault,
    choosePair,
    toggleOne,
    scenarios,
    showScenario,
    canSwap,
    swap,
    themeCommands: theme.commands,
    setSwitcher,
    upload,
  })
  const viewer = chrome === 'viewer'
  const notices = viewNotices({
    reported:
      showing === 'artifact' && artifact?.notices?.length !== undefined && artifact.notices.length > 0
        ? artifact.notices
        : (job?.notices ?? []),
    shownBefore: pair.subject?.mode === 'comparison' ? choices.find(choice => choice.key === before)?.document : undefined,
    shownAfter: choices.find(choice => choice.key === after)?.document,
    viewer,
  })
  useInspectorHandle({
    handleRef,
    controllers,
    state: {
      definitions,
      projection,
      marked,
      showing,
      before,
      after,
      error,
      outcome: pair.outcome.status,
      rows,
      definitionRevision,
      switching,
      running,
      scenario: shownScenario,
      notices,
    },
    actions: {switchProjection, switcherStatus, extract, retry: pair.retry, chooseDefinition, cancel, requestScenario},
    setSource,
    setMarks,
    dropQueued,
    setRows,
  })

  const trustState = trustStateOf({
    connected: Boolean(api),
    known: Boolean(definitions && projection),
    needsTrust,
    authorized,
  })
  const pairChoices = choices.filter(choice => choice.key === after || (pair.outcome.status === 'compared' && choice.key === before))
  const panelTabs = inspectorPanelTabs({
    diagnostics,
    jobs: api ? jobs : undefined,
    pairChoices,
    comparison,
    beforeLabel: labelOf(before) ?? 'A',
    afterLabel: labelOf(after) ?? 'B',
  })

  const {title, center, titleKey} = inspectorTitleBar({
    activity: {
      api,
      artifact,
      loading,
      definitions,
      connected,
      showing,
      shownScenario,
      scenarios,
      active,
      projection,
      sides,
      failedSides,
      runnable,
      needsTrust,
      paired,
      marked,
      live,
      definitionRevision,
      projectionRows,
      replay,
      definition: definitions?.definitions.find(item => item.id === projection),
      policy,
    },
    connected: Boolean(api),
    watching: Boolean(api && watching && live),
    artifactName: artifact?.name,
    loadingArtifact,
    upload,
    openArtifact,
    theme,
    definitionChoice: {value: definitionRevision, revisions: definitionOptions, onChange: chooseDefinition, disabled: loading || busy},
    switcher: {...switcherList, open: switcher, onOpenChange: setSwitcher, onChoose: switchProjection, loading},
  })
  const mode = api ? 'repository' : 'offline'

  const sections = explorerSections({
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
  })
  const sidebar = <Explorer label="Explorer" scope={mode} sections={sections} />

  const status = (
    <InspectorStatus
      pair={pair}
      before={before}
      after={after}
      labelOf={labelOf}
      lastTiming={lastTiming}
      api={Boolean(api)}
      trustState={trustState}
    />
  )

  const bare = chrome !== 'workbench'
  const rendererNotice = viewer && pair.resolution.notice && mentionsPath(pair.resolution.notice) ? undefined : pair.resolution.notice
  const body = (
    <InspectorBody
      error={error}
      onDismissError={() => setError(null)}
      viewer={viewer}
      bare={bare}
      invalid={definitions?.invalid ?? []}
      failures={{
        sides,
        failedSides,
        projectionRows,
        jobs,
        onRetry: runnable ? ref => extract([ref]) : undefined,
        setPanelRequest,
      }}
      pair={pair}
      chosen={choices.length > 0}
      Loading={Loading}
      presented={{
        View,
        showing,
        projection,
        artifact,
        colorMode: theme.colorMode,
        themeTokens: theme.themeTokens,
        notices,
        rendererNotice,
        onOpen,
        controllers,
        ...(api ? {running: running ?? null} : {}),
        ...(bare && toolbarStart !== undefined ? {toolbarStart} : {}),
        ...(bare && utilityArea ? {utilityArea} : {}),
      }}
      empty={{
        Loading,
        api,
        projection,
        openedProjection: openedInitially?.projection,
        bare,
        viewer,
        busy,
        active,
        cancel,
        showing,
        needsTrust,
        authorized,
        runCommand,
        usesOwnRenderer,
        rendererPolicy,
        ownDefinition,
        failedSides,
      }}
    />
  )
  if (bare) {
    return (
      <BareFrame colorMode={theme.colorMode} viewer={viewer} mode={mode} banner={banner} aside={aside}>
        {body}
      </BareFrame>
    )
  }
  return (
    <InspectorWorkbench
      shell={{
        colorMode: theme.colorMode,
        center,
        title,
        titleKey,
        sidebar,
        panelTabs,
        panelTab,
        onPanelTab: setPanelTab,
        panelRequest,
        status,
        commands,
        'data-mode': mode,
      }}
      details={{
        store: controllers,
        onOpen,
        beforeLabel: pair.subjectLabels.before ?? 'A',
        afterLabel: pair.subjectLabels.after ?? 'B',
      }}
      notes={{
        definitions: api ? definitions : undefined,
        opened: Boolean(initialDocument),
        setupDismissed,
        onDismissSetup: () => setSetupDismissed(true),
      }}
    >
      {body}
    </InspectorWorkbench>
  )
}
