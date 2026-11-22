import * as vscode from 'vscode'
import {existsSync} from 'node:fs'
import {
  Debouncer,
  RulesService,
  codePointColumn,
  encodeTokens,
  rulesKind,
  rulesPatterns,
  tokenModifiers,
  tokenTypes,
  utf16Range,
  type RulesKind,
} from './rules-service.js'
import {noop} from './noop.ts'

/** How long typing pauses before a comparator file is checked again. */
const diagnosticsDelayMs = 300

const legend = new vscode.SemanticTokensLegend([...tokenTypes], [...tokenModifiers])

const completionKinds: Record<string, vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  method: vscode.CompletionItemKind.Method,
  macro: vscode.CompletionItemKind.Snippet,
  variable: vscode.CompletionItemKind.Variable,
  parameter: vscode.CompletionItemKind.Variable,
  input: vscode.CompletionItemKind.Constant,
  field: vscode.CompletionItemKind.Field,
  property: vscode.CompletionItemKind.Property,
  namespace: vscode.CompletionItemKind.Module,
  keyword: vscode.CompletionItemKind.Keyword,
}

function kindOf(document: vscode.TextDocument): RulesKind | undefined {
  return rulesKind(document.uri.path)
}

function range(document: vscode.TextDocument, at: {line: number; column: number; endLine: number; endColumn: number}) {
  const {startLine, startCharacter, endLine, endCharacter} = utf16Range(at, index =>
    index < document.lineCount ? document.lineAt(index).text : '',
  )
  return new vscode.Range(startLine, startCharacter, endLine, endCharacter)
}

/**
 * Editing comparator files (`*.comparator.yaml`) and their tests (`*.comparator.test.yaml`): semantic highlighting of the
 * CEL in exactly the values that are expressions, live diagnostics from the checker that loads them, hovers and
 * completions. Everything runs in the language service the extension ships (`projections_rules_editor` in
 * `rules-editor.wasm`, built from the rules interpreter's own reader and checker), in a worker thread, so it needs
 * neither the CLI nor workspace trust. Red Hat YAML's schema validation
 * (`yamlValidation`) keeps working beside it: these providers answer only inside expressions.
 */
export function registerRulesLanguage(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): vscode.Disposable {
  const wasm = context.asAbsolutePath('dist/rules-editor.wasm')
  const worker = context.asAbsolutePath('dist/rules-worker.cjs')
  if (!existsSync(wasm) || !existsSync(worker)) {
    output.warn(`Comparator file editing is off: ${existsSync(wasm) ? worker : wasm} is missing`)
    return new vscode.Disposable(noop)
  }
  const service = new RulesService({worker, wasm})
  let reported = false
  /** Runs a request, logging the first failure (later ones are usually the same). */
  const attempt = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run()
    } catch (error) {
      if (!reported) output.warn(`Comparator file editing: ${error instanceof Error ? error.message : String(error)}`)
      reported = true
      return undefined
    }
  }
  const selector: vscode.DocumentSelector = rulesPatterns.map(pattern => ({pattern}))
  const diagnostics = vscode.languages.createDiagnosticCollection('projections-rules')
  const debouncer = new Debouncer(diagnosticsDelayMs)

  const check = async (document: vscode.TextDocument) => {
    const kind = kindOf(document)
    if (!kind || document.isClosed) return
    const version = document.version
    const found = await attempt(() => service.diagnostics(document.getText(), kind))
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the document can close during the await
    if (!found || document.isClosed || document.version !== version) return
    diagnostics.set(
      document.uri,
      found.map(item => {
        const diagnostic = new vscode.Diagnostic(
          range(document, item),
          item.message,
          item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
        )
        diagnostic.source = 'projections rules'
        diagnostic.code = item.code
        return diagnostic
      }),
    )
  }
  const schedule = (document: vscode.TextDocument) => {
    if (kindOf(document)) debouncer.schedule(document.uri.toString(), () => void check(document))
  }

  const tokens: vscode.DocumentSemanticTokensProvider = {
    async provideDocumentSemanticTokens(document) {
      const kind = kindOf(document)
      if (!kind) return undefined
      const found = await attempt(() => service.tokens(document.getText(), kind))
      if (!found) return undefined
      return new vscode.SemanticTokens(
        Uint32Array.from(encodeTokens(found, index => (index < document.lineCount ? document.lineAt(index).text : ''))),
      )
    },
  }

  const hovers: vscode.HoverProvider = {
    async provideHover(document, position) {
      const kind = kindOf(document)
      if (!kind) return undefined
      const line = document.lineAt(position.line).text
      const found = await attempt(() =>
        service.hover(document.getText(), kind, position.line + 1, codePointColumn(line, position.character)),
      )
      if (!found) return undefined
      return new vscode.Hover(new vscode.MarkdownString(found.markdown), range(document, found))
    },
  }

  const completions: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const kind = kindOf(document)
      if (!kind) return undefined
      const line = document.lineAt(position.line).text
      const found = await attempt(() =>
        service.complete(document.getText(), kind, position.line + 1, codePointColumn(line, position.character)),
      )
      if (!found?.range || found.items.length === 0) return undefined
      const replace = range(document, {...found.range, endLine: found.range.line})
      return found.items.map(entry => {
        const item = new vscode.CompletionItem(entry.label, completionKinds[entry.kind] ?? vscode.CompletionItemKind.Text)
        if (entry.detail) item.detail = entry.detail
        if (entry.documentation) item.documentation = new vscode.MarkdownString(entry.documentation)
        if (entry.insert) item.insertText = new vscode.SnippetString(entry.insert)
        item.range = replace
        return item
      })
    },
  }

  for (const document of vscode.workspace.textDocuments) void check(document)
  return vscode.Disposable.from(
    diagnostics,
    {dispose: () => debouncer.dispose()},
    {dispose: () => service.dispose()},
    vscode.languages.registerDocumentSemanticTokensProvider(selector, tokens, legend),
    vscode.languages.registerHoverProvider(selector, hovers),
    vscode.languages.registerCompletionItemProvider(selector, completions, '.'),
    vscode.workspace.onDidOpenTextDocument(document => void check(document)),
    vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => {
      debouncer.cancel(document.uri.toString())
      diagnostics.delete(document.uri)
    }),
  )
}
