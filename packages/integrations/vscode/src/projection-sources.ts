import * as vscode from 'vscode'
import {definitionModel, flattenSources} from './configuration-model.js'
import type {DefinitionNode, ScenariosFile, SourceItem} from './configuration-model.js'
import {sourceParts} from './definition.js'
import {parseScenarios, scenariosFor} from './develop-model.js'
import type {BundledDocs} from './docs.js'
import type {QuickPicks} from './pickers.js'
import type {Sidebar} from './sidebar.js'

/** The definition file (in `.github/projections` or `.projections`) that defines a projection. */
export async function definitionFile(folder: vscode.WorkspaceFolder, id: string): Promise<vscode.Uri | undefined> {
  for (const directory of ['.github/projections', '.projections']) {
    // Read the directory itself: file search skips dot-directories and ignored files, which definitions live in.
    const base = vscode.Uri.joinPath(folder.uri, ...directory.split('/'))
    const entries = await vscode.workspace.fs.readDirectory(base).then(
      list => list,
      () => [] as [string, vscode.FileType][],
    )
    const files = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
      .map(([name]) => vscode.Uri.joinPath(base, name))
    for (const file of files) {
      try {
        const value = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file))) as {id?: unknown}
        if (value.id === id) return file
      } catch {
        // Not this one.
      }
    }
  }
  return undefined
}

/** Whether a workspace file exists. */
const exists = (uri: vscode.Uri) =>
  vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  )

/** A definition's renderer's `scenarios.json` files (by its name, or the package holding its bundle), with their scenarios. */
async function rendererScenarios(folder: vscode.WorkspaceFolder, definition: Parameters<typeof sourceParts>[0]): Promise<ScenariosFile[]> {
  const renderer =
    typeof definition.renderer === 'string'
      ? {label: definition.renderer}
      : {
          label: definition.renderer.bundle,
          bundle: definition.renderer.bundle,
        }
  const found: ScenariosFile[] = []
  for (const uri of await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/scenarios.json'),
    '**/{node_modules,.git,dist}/**',
    50,
  )) {
    const text = await vscode.workspace.fs.readFile(uri).then(
      bytes => new TextDecoder().decode(bytes),
      () => '',
    )
    const parsed = parseScenarios(text)
    const path = vscode.workspace.asRelativePath(uri, false)
    const directory = path.split('/').slice(0, -1).join('/')
    if (
      parsed &&
      scenariosFor(
        {
          directory,
          ...(parsed.renderer ? {renderer: parsed.renderer} : {}),
        },
        renderer,
      )
    ) {
      found.push({path, directory, count: parsed.scenarios.length})
    }
  }
  return found
}

/** What is behind a projection: the Definition view's model of it, and Go to Source…, which opens its files. */
export class ProjectionSources {
  /** For tests: the items Go to Source… showed last. */
  last: string[] = []

  constructor(
    private readonly sidebar: Sidebar,
    private readonly docs: BundledDocs,
    private readonly picks: QuickPicks,
  ) {}

  /**
   * What is behind a projection, as one model (`definitionModel`): the Definition view shows it and Go to Source…
   * flattens it (`sourceItems`). Its definition file, parts, the comparator's tests, a custom renderer's source entry,
   * the renderer's scenarios and the environment, those that exist.
   */
  async nodes(folder: vscode.WorkspaceFolder, id: string): Promise<DefinitionNode[]> {
    const model = this.sidebar.model(folder)
    await model.load()
    const definition = model.definition(id)
    const file = await definitionFile(folder, id)
    const relative = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false)
    const at = (path: string) => vscode.Uri.joinPath(folder.uri, ...path.replace(/^\.\//, '').split('/'))
    const parts = definition ? sourceParts(definition, await this.docs.index()) : []
    const comparator = parts.find(part => part.part === 'comparator')?.file
    const tests = comparator?.replace(/\.comparator\.(ya?ml)$/, '.comparator.test.$1')
    const bundle =
      definition && typeof definition.renderer !== 'string'
        ? definition.renderer.bundle.replace(/^\.\//, '').replace(/\/+$/, '')
        : undefined
    // A custom renderer's package: its bundle's directory, or the one above a built `dist`/`build`.
    const packageDir = bundle ? bundle.replace(/\/(dist|build|out)$/, '') : undefined
    let rendererSource: string | undefined
    // An entry of its own, else the view module `rendererConfig({view})` generates the entry for.
    const candidates = [
      'src/index.tsx',
      'src/index.ts',
      'src/main.tsx',
      'src/main.ts',
      'src/index.js',
      'src/view.tsx',
      'src/view.ts',
      'index.html',
    ]
    for (const candidate of packageDir ? candidates : []) {
      if (await exists(at(`${packageDir}/${candidate}`))) {
        rendererSource = `${packageDir}/${candidate}`
        break
      }
    }
    const environment = file ? vscode.Uri.joinPath(file, '..', 'environment.json') : undefined
    return definitionModel({
      ...(file ? {definition: relative(file)} : {}),
      parts,
      ...(tests && tests !== comparator && (await exists(at(tests))) ? {comparatorTests: tests} : {}),
      ...(rendererSource ? {rendererSource} : {}),
      ...(definition ? {scenarios: await rendererScenarios(folder, definition)} : {}),
      ...(environment && (await exists(environment)) ? {environment: relative(environment)} : {}),
    })
  }

  /**
   * Opens one of Go to Source…'s entries, never outside VS Code: a file in an editor, a built-in's bundled docs in the
   * Markdown preview, Configure… the default comparator. To the side of the projection tab unless `here`.
   */
  async open(folder: vscode.WorkspaceFolder, item: SourceItem, here = false) {
    if (item.file) {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...item.file.split('/')), {
        viewColumn: here ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside,
        preview: true,
      })
      return
    }
    if (item.command) {
      await vscode.commands.executeCommand(item.command)
      return
    }
    if (item.docs) await this.docs.open(item.docs, {here})
  }

  /**
   * Go to Source…: the files behind the projection in front. One file opens directly; several are a quick pick grouped
   * by part (definition, extractor, comparator, renderer, environment), opening to the side unless its "Open in this
   * group" button is used. A built-in opens its bundled docs in VS Code; the default comparator, Configure… (its docs a
   * button). Only an item's Open Documentation on GitHub button leaves VS Code.
   */
  async goTo(folder: vscode.WorkspaceFolder, id: string) {
    const items = flattenSources(await this.nodes(folder, id))
    const open = (item: SourceItem, here = false) => this.open(folder, item, here)
    const files = items.filter(item => item.file)
    this.last = items.map(item => `${item.group}: ${item.label}`)
    // One real file (built-ins leave only the definition): it opens directly.
    if (files.length === 1) {
      await open(files[0]!)
      return
    }
    type Entry = vscode.QuickPickItem & {item?: SourceItem}
    const here: vscode.QuickInputButton = {iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: 'Open in this group'}
    const read: vscode.QuickInputButton = {iconPath: new vscode.ThemeIcon('book'), tooltip: 'Open Documentation'}
    const github: vscode.QuickInputButton = {iconPath: new vscode.ThemeIcon('link-external'), tooltip: 'Open Documentation on GitHub'}
    const entries: Entry[] = []
    for (const item of items) {
      if (entries.at(-1)?.item?.group !== item.group) entries.push({label: item.group, kind: vscode.QuickPickItemKind.Separator})
      const buttons = item.file ? [here] : item.command ? (item.docs ? [read, github] : []) : item.docs ? [here, github] : []
      entries.push({
        label: `$(${item.file ? 'file' : item.command ? 'settings-gear' : 'book'}) ${item.label}`,
        ...(item.description ? {description: item.description} : {}),
        ...(buttons.length ? {buttons} : {}),
        item,
      })
    }
    const pick = vscode.window.createQuickPick<Entry>()
    pick.items = entries
    pick.title = `${this.sidebar.model(folder).title(id)}: Go to Source`
    pick.placeholder = 'The files behind this projection (they open to the side)'
    pick.matchOnDescription = true
    await new Promise<void>(resolve => {
      pick.onDidAccept(() => {
        const item = (pick.selectedItems[0] ?? pick.activeItems[0])?.item
        pick.hide()
        if (item) void open(item)
      })
      pick.onDidTriggerItemButton(event => {
        pick.hide()
        const item = event.item.item
        if (!item) return
        if (event.button === github) void this.docs.openOnGitHub(item.docs)
        else if (event.button === read && item.docs) void this.docs.open(item.docs)
        else void open(item, true)
      })
      pick.onDidHide(() => {
        this.picks.open--
        pick.dispose()
        resolve()
      })
      pick.show()
      this.picks.open++
    })
  }
}
