import * as vscode from 'vscode'
import {launch, sourceKey, withBackend} from './backend-sources.js'
import type {PanelSource} from './backend-sources.js'
import {BackendPool} from './backends.js'
import {pairCommands} from './commands/pair.js'
import {partCommands} from './commands/part.js'
import {rowCommands} from './commands/row.js'
import {inspectorCommands} from './commands/inspector.js'
import {tabCommands} from './commands/tab.js'
import {extensionApi} from './extension/test-api.js'
import {projectionUri, projectionViewType} from './decorations.js'
import {DefinitionView} from './definition.js'
import {BundledDocs} from './docs.js'
import {registerEnvironment} from './environment.js'
import {agentTools} from './language-model-tools.js'
import {registerNewProjection} from './new-projection.js'
import {addToCi} from './add-to-ci.js'
import {adopt, PreviewDocuments, previewScheme} from './onboarding.js'
import {InspectorPanel} from './panels/inspector-panel.js'
import {activeDefinitionTarget, projectionEditor} from './panels/projection-editor.js'
import {ProjectionTab} from './panels/projection-tab.js'
import {chooseFolder, folderFrom, pickPullRequest, QuickPicks} from './pickers.js'
import {ProjectionSources} from './projection-sources.js'
import {relativePath} from './protocol.js'
import {branchPullRequest} from './pulls.js'
import {resolveCommits} from './refs.js'
import {RendererBuilds} from './renderer-builds.js'
import {registerRulesLanguage} from './rules-language.js'
import type {Services} from './services.js'
import {Sidebar} from './sidebar.js'
import {setProjectionIcon} from './sidebar/items.js'
import {StatusBar} from './status-bar.js'
import {ProjectionTests} from './testing.js'
import {ViewingView} from './viewing.js'
import type {OnboardingArguments} from './writes.js'

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Projections', {log: true})
  const backends = new BackendPool<PanelSource>(
    source => launch(context, output, source),
    sourceKey,
    line => output.info(line),
  )
  // The Projections activity bar container, on each folder's shared backend.
  setProjectionIcon(context.extensionUri)
  const sidebar = new Sidebar(folder => backends.lease({kind: 'repository', folder}), output, context.workspaceState)
  const docs = new BundledDocs(vscode.Uri.joinPath(context.extensionUri, 'dist', 'docs'), output)
  context.subscriptions.push(docs)
  const picks = new QuickPicks()
  const services: Services = {
    context,
    output,
    backends,
    sidebar,
    docs,
    picks,
    tabsChanged: new vscode.EventEmitter<void>(),
    withBackend: (folder, action) => withBackend(backends, folder, action),
  }
  const {tabsChanged} = services
  const sources = new ProjectionSources(sidebar, docs, picks)
  /** The Definition view, which follows the active projection tab. */
  let definitionView: DefinitionView | undefined
  /** The Viewing view: everything that changes what every projection tab shows. */
  let viewingView: ViewingView | undefined
  let statusBar: StatusBar | undefined
  // Projections in the Testing view (their checks and comparator tests), from the folder's backend.
  const tests = new ProjectionTests(
    folder => backends.lease({kind: 'repository', folder}),
    {
      projections: async folder => {
        const model = sidebar.model(folder)
        await model.load()
        return model.projections.map(definition => ({id: definition.id, title: model.title(definition.id)}))
      },
      onDidChange: sidebar.onDidUpdate,
    },
    output,
  )
  /**
   * Opens a projection's tab. Like a file in the Explorer, a single click opens it in the preview (italic) tab and a
   * double click (a second open of the same row right after) keeps it.
   */
  let lastOpen: {key: string; at: number} | undefined
  const openProjection = async (folderUri: vscode.Uri | string, id: string, options: {preview?: boolean} = {}) => {
    const folder = vscode.workspace.getWorkspaceFolder(typeof folderUri === 'string' ? vscode.Uri.parse(folderUri) : folderUri)
    if (!folder) throw new Error('That folder is not open')
    const model = sidebar.model(folder)
    await model.load()
    const title = model.definition(id) ? model.title(id) : (model.invalidFor(id)?.id ?? id)
    const key = `${folder.uri.toString()}#${id}`
    const now = Date.now()
    const again = lastOpen?.key === key && now - lastOpen.at < 500
    lastOpen = {key, at: now}
    await vscode.commands.executeCommand('vscode.openWith', projectionUri(folder, id, title), projectionViewType, {
      preview: options.preview ?? !again,
    })
  }
  const tools = agentTools(services, openProjection)
  // New Projection…: the (+) in the Projections section's title bar, its welcome and the command palette.
  const newProjection = registerNewProjection({
    extensionPath: context.extensionPath,
    output,
    chooseFolder,
    pick: picks.show,
    model: folder => sidebar.model(folder),
    withBackend: services.withBackend,
    openProjection,
    reveal: (folder, id) => sidebar.revealProjection(folder, id),
  })
  const previews = new PreviewDocuments()
  /** Adopt…: a backend for the chosen folder, and errors shown rather than thrown. */
  const onboarding = (write: typeof adopt) => async (args?: OnboardingArguments) => {
    const folder = await chooseFolder()
    if (!folder) return undefined
    try {
      const result = await services.withBackend(folder, runner => write(runner, folder.uri, previews, args ?? {}))
      if (result?.written) {
        InspectorPanel.refreshExplore(folder)
        // After the first adoption, Suggested offers Add to CI…; using it ends the offer.
        sidebar.offerAddToCi(true)
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      output.error(message)
      void vscode.window.showErrorMessage(`Projections: ${message}`)
      return undefined
    }
  }
  context.subscriptions.push(
    output,
    // Highlighting, diagnostics, hovers and completions in comparator files (*.comparator.yaml), from the shipped rules interpreter.
    registerRulesLanguage(context, output),
    tests,
    sidebar,
    tabsChanged,
    (services.rendererBuilds = new RendererBuilds(
      {
        projections: folder => sidebar.model(folder).projections,
        hasTab: (folder, projection) =>
          [...ProjectionTab.tabs].some(tab => tab.folder.uri.toString() === folder.uri.toString() && tab.projection === projection),
        onDidChangeTabs: tabsChanged.event,
        lease: folder => backends.lease({kind: 'repository', folder}),
      },
      output,
    )),
    // A build's state is the Definition view's Renderer row.
    services.rendererBuilds.onDidChange(() => tabsChanged.fire()),
    (viewingView = new ViewingView(sidebar, {
      request: (folder, request) => services.withBackend(folder, runner => runner.request(request)),
      resolveCommits,
      pullRequest: (folder, branch) => branchPullRequest(folder.uri.fsPath, branch),
    })),
    // Pull request… in the Viewing view: its sub-pick, then the repository's choice.
    vscode.commands.registerCommand('projections.choosePullRequest', async (argument?: unknown) => {
      const folder = await folderFrom(argument)
      if (!folder) return
      const choice = await pickPullRequest(sidebar, folder)
      if (choice) sidebar.model(folder).choose(choice)
    }),
    (definitionView = new DefinitionView(
      {
        active: activeDefinitionTarget,
        find: (folder, projection) =>
          [...ProjectionTab.tabs]
            .reverse()
            .find(tab => tab.folder === folder && tab.projection === projection)
            ?.definitionTarget(),
        sources: (folder, id) => sources.nodes(folder, id),
        rendererBuild: (folder, projection) => services.rendererBuilds?.state(folder, projection),
        onDidChange: tabsChanged.event,
      },
      sidebar,
      output,
    )),
    (statusBar = new StatusBar(
      sidebar,
      () => viewingView!.model(),
      [viewingView.view, sidebar.projectionsView, definitionView.view, sidebar.suggestedView],
      // The jobs of the folder's other tabs, which the item's tooltip counts.
      folder =>
        [...ProjectionTab.tabs].flatMap(tab =>
          tab !== ProjectionTab.current && tab.folder.uri.toString() === folder.uri.toString() && tab.running ? [tab.running] : [],
        ),
    )),
    vscode.window.registerCustomEditorProvider(projectionViewType, projectionEditor(services), {
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('projections.openProjection', openProjection),
    ...rowCommands(sidebar),
    ...pairCommands(services, viewingView),
    ...tabCommands(sources),
    ...partCommands(picks),
    vscode.commands.registerCommand('projections.refresh', () => sidebar.refresh()),
    ...registerEnvironment(folder => backends.lease({kind: 'repository', folder})),
    vscode.commands.registerCommand('projections.adoptCandidate', (node?: {candidate?: {id?: string}}) =>
      vscode.commands.executeCommand('projections.adopt', node?.candidate?.id ? {projections: [node.candidate.id]} : undefined),
    ),
    // An invalid definition's diagnostic, at its line.
    vscode.commands.registerCommand('projections.openDefinitionProblem', async (folderUri: vscode.Uri, path: string, index = 0) => {
      const folder = vscode.workspace.getWorkspaceFolder(folderUri)
      const relative = relativePath(path)
      if (!folder || !relative) return
      const diagnostic = sidebar.model(folder).invalid.find(item => item.path === path)?.diagnostics[index]
      const line = Math.max(0, (diagnostic?.location?.line ?? 1) - 1)
      const column = Math.max(0, (diagnostic?.location?.column ?? 1) - 1)
      await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...relative.split('/')), {
        selection: new vscode.Range(line, column, line, column),
      })
    }),
    // The repository's own code runs once the workspace is trusted: its backends, and renderer scenarios' (whose
    // bundles are repository code), restart with --trust.
    vscode.workspace.onDidGrantWorkspaceTrust(
      () => void backends.restart(source => source.kind === 'repository' || source.kind === 'fixtures', 'The workspace is now trusted'),
    ),
    vscode.workspace.registerTextDocumentContentProvider(previewScheme, previews),
    vscode.commands.registerCommand('projections.adopt', onboarding(adopt)),
    vscode.commands.registerCommand('projections.addToCi', async (choice?: unknown) => {
      const chosen = await addToCi(choice)
      if (chosen) sidebar.offerAddToCi(false)
      return chosen
    }),
    newProjection.disposable,
    ...inspectorCommands(services),
    ...tools.disposables,
    {dispose: () => InspectorPanel.disposeAll()},
    {dispose: () => backends.dispose()},
  )
  return extensionApi({
    services,
    sidebar,
    tests,
    tools,
    newProjection,
    sources,
    docs,
    picks,
    definitionView: () => definitionView!,
    viewingView: () => viewingView!,
    statusBar: () => statusBar!,
  })
}

export function deactivate() {}
