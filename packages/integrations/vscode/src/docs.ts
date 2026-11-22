// The documentation bundled with the extension (dist/docs, which scripts/docs.mjs builds), read inside VS Code: a
// built-in part's row opens its page in VS Code's Markdown preview, never the browser. The preview opens the bundle's
// own files, so it resolves a page's relative links natively: a link to another bundled page opens that page in the
// preview too, and the bundle rewrites every other link to the file on GitHub. The page's file on GitHub is otherwise
// only an explicit secondary action (Open Documentation on GitHub).
import * as vscode from 'vscode'
import {docsOnGitHub, docsPage, type DocsIndex} from './projections/docs.js'

/** The Markdown preview as an editor (Open With… › Markdown Preview): its tab names the page and holds its URI. */
const markdownPreview = 'vscode.markdown.preview.editor'

/** How many times the extension opened something outside VS Code, for tests: a row's click never does. */
let externalOpens = 0

/** Opens a URI outside VS Code: only ever an explicit action (a link in a renderer, Open Documentation on GitHub). */
export function openExternal(uri: vscode.Uri): Thenable<boolean> {
  externalOpens++
  return vscode.env.openExternal(uri)
}

/** The bundle's directory, once the extension has started (dist/docs). */
let bundleRoot: vscode.Uri | undefined

/** A bundled page's file (`extractors/workspace-dependencies.md`), or undefined before the bundle is known or for a bad name. */
export function bundledDocsUri(page: string): vscode.Uri | undefined {
  const valid = docsPage(page)
  return bundleRoot && valid ? vscode.Uri.joinPath(bundleRoot, ...valid.split('/')) : undefined
}

/** The bundled page a URI is, or undefined when it isn't one of the bundle's files. */
export function bundledDocsPage(uri: vscode.Uri): string | undefined {
  if (!bundleRoot || uri.scheme !== bundleRoot.scheme || uri.authority !== bundleRoot.authority) return undefined
  const prefix = `${bundleRoot.path.replace(/\/+$/u, '')}/`
  return uri.path.startsWith(prefix) ? docsPage(uri.path.slice(prefix.length)) : undefined
}

export class BundledDocs implements vscode.Disposable {
  private indexRead: Promise<DocsIndex | undefined> | undefined
  /** The pages opened, for tests. */
  readonly reads: string[] = []
  private readonly disposables: vscode.Disposable[]

  private readonly root: vscode.Uri
  private readonly output: vscode.LogOutputChannel

  constructor(root: vscode.Uri, output: vscode.LogOutputChannel) {
    this.root = root
    this.output = output
    bundleRoot = root
    this.disposables = [
      vscode.commands.registerCommand('projections.openDocumentation', (page?: unknown) =>
        typeof page === 'string' ? this.open(page) : undefined,
      ),
      vscode.commands.registerCommand('projections.openDocumentationOnGitHub', (target?: unknown) => this.openOnGitHub(target)),
    ]
  }

  /** The bundle's index (dist/docs/index.json), read once; undefined when the build has none. */
  index(): Promise<DocsIndex | undefined> {
    this.indexRead ??= Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, 'index.json'))).then(
      bytes => JSON.parse(new TextDecoder().decode(bytes)) as DocsIndex,
      (error: unknown) => {
        this.output.warn(`The bundled documentation has no index: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      },
    )
    return this.indexRead
  }

  /**
   * Opens a bundled page in the Markdown preview (its source, read-only, when the preview isn't available): beside the
   * editor in front, as Open Preview to the Side does, or over the docs already open; `here` opens it in the active group.
   */
  async open(page: string, options: {here?: boolean} = {}) {
    const uri = bundledDocsUri(page)
    if (!uri) return
    this.reads.push(page)
    const shown = vscode.window.tabGroups.all.find(group => {
      const input = group.activeTab?.input
      return input instanceof vscode.TabInputCustom && input.viewType === markdownPreview && bundledDocsPage(input.uri) !== undefined
    })
    const viewColumn = options.here ? vscode.ViewColumn.Active : (shown?.viewColumn ?? vscode.ViewColumn.Beside)
    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, markdownPreview, {preview: true, viewColumn})
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri, {preview: true, viewColumn})
    }
  }

  /** Open Documentation on GitHub: a page (or a Definition row's), on GitHub. The one way the docs leave VS Code. */
  async openOnGitHub(target: unknown) {
    const page =
      typeof target === 'string'
        ? target
        : target instanceof vscode.Uri
          ? bundledDocsPage(target)
          : (target as {node?: {docs?: unknown}} | undefined)?.node?.docs
    const url = typeof page === 'string' ? docsOnGitHub(await this.index(), page) : undefined
    if (url) await openExternal(vscode.Uri.parse(url))
  }

  /** For tests: the pages opened, and how many times the extension opened something outside VS Code. */
  state() {
    return {reads: [...this.reads], externalOpens}
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    bundleRoot = undefined
  }
}
