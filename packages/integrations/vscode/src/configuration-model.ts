// The Definition view's logic, without VS Code: what it follows, and the one item model it shares with Go to Source….
// Pure, so unit tests import it directly.

/**
 * What the view shows as the active editor changes, like Outline: the projection of a projection tab; the
 * one it shows already while the editor is one of that projection's own files (its definition, or a part's file,
 * which the view opens); else nothing. A pinned view keeps its projection whatever is active.
 */
export function follow<T extends {folder: string; projection: string}>(input: {
  pinned: T | undefined
  /** The active tab's projection, when it is a projection tab. */
  tab: T | undefined
  shown: T | undefined
  /** The active text editor's path, and the shown projection's own files. */
  editor?: string | undefined
  files?: readonly string[] | undefined
}): T | undefined {
  if (input.pinned) return input.pinned
  if (input.tab) return input.tab
  if (input.shown && input.editor && input.files?.includes(input.editor)) return input.shown
  return undefined
}

/**
 * The diagnostics a tab's shown extractions report (an extraction document's `diagnostics`, or its `extraction`'s),
 * each named by its side: `After: 2 files couldn't be parsed`. Duplicates across sides are kept once.
 */
export function extractionMessages(documents: readonly {side: string; document: unknown}[]): string[] {
  const seen = new Set<string>()
  const messages: string[] = []
  for (const {side, document} of documents) {
    const value = document as {diagnostics?: unknown; extraction?: {diagnostics?: unknown}} | null
    for (const list of [value?.diagnostics, value?.extraction?.diagnostics]) {
      for (const item of Array.isArray(list) ? list : []) {
        const message = String((item as {message?: unknown} | null)?.message ?? JSON.stringify(item))
        if (seen.has(message)) continue
        seen.add(message)
        messages.push(`${side}: ${message}`)
      }
    }
  }
  return messages
}

/** A tab's kept results as sides: Before and After (or the one revision), each with its ref and document. */
export function keptSides(
  kept: {pair: {before?: string; after: string}; results: Record<string, {document: unknown}>} | undefined,
): {side: string; ref: string; document: unknown}[] {
  if (!kept) return []
  const {pair, results} = kept
  return [
    ...(pair.before && results[pair.before] ? [{side: 'Before', ref: pair.before, document: results[pair.before]!.document}] : []),
    ...(results[pair.after] ? [{side: pair.before ? 'After' : 'Shown', ref: pair.after, document: results[pair.after]!.document}] : []),
  ]
}

/**
 * Whether a tab shows its result's provenance badge: only when it is unusual (From CI, Imported, Approximate, Stale or Observed).
 * An ordinary local extraction shows none; the summary bar's tooltip names it either way.
 */
export function unusualProvenance(label: string | undefined): boolean {
  return Boolean(label && label !== 'Local')
}

/** A part as the Definition view and Go to Source… read it (`parts()` with a built-in's bundled page). */
export interface SourcePart {
  part: 'extractor' | 'comparator' | 'renderer'
  label: string
  file?: string | undefined
  /** A built-in's bundled documentation page (`partDocs`). */
  docs?: string | undefined
}

/** A renderer's `scenarios.json`: its workspace-relative path, its directory and how many scenarios it has. */
export interface ScenariosFile {
  path: string
  directory?: string | undefined
  count?: number | undefined
}

/** What the extension found behind a projection: its definition file, parts and the optional files beside them. */
export interface DefinitionInput {
  definition?: string | undefined
  parts: readonly SourcePart[]
  comparatorTests?: string | undefined
  rendererSource?: string | undefined
  scenarios?: readonly (string | ScenariosFile)[] | undefined
  environment?: string | undefined
}

/**
 * One node of the projection's definition: the Definition view's row (its children under it) and, flattened, Go to
 * Source…'s entries. Parts are named by their kind (`Extractor`) with their value verbatim (`workspace-dependencies`);
 * files by their name.
 */
export interface DefinitionNode {
  kind: 'definition' | 'extractor' | 'comparator' | 'renderer' | 'environment' | 'tests' | 'source' | 'scenarios'
  group: 'Definition' | 'Extractor' | 'Comparator' | 'Renderer' | 'Environment'
  label: string
  /** A part's value as the definition says it, or a scenarios file's directory. */
  value?: string
  /** A workspace-relative file. */
  file?: string
  /** A built-in's bundled documentation page, which opens in VS Code's Markdown preview. */
  docs?: string
  /** Configure… the default comparator. */
  command?: string
  /** A scenarios file's scenario count. */
  count?: number
  children: DefinitionNode[]
}

/** One entry of Go to Source…: a file to open, a built-in's bundled docs, or a command (Configure… the default comparator). */
export interface SourceItem {
  group: DefinitionNode['group']
  label: string
  description?: string
  /** A workspace-relative file. */
  file?: string
  /** A built-in's bundled documentation page. */
  docs?: string
  command?: string
}

const baseName = (path: string) => path.split('/').at(-1) ?? path

/**
 * The definition as one tree, in order: its file; Extractor; Comparator (its tests file under it, or Configure… the
 * built-in); Renderer (a custom renderer's source entry and its `scenarios.json` files under it); Environment. The
 * Definition view shows it as it is, and Go to Source… flattens it (`sourceItems`); the extension says which optional
 * files exist.
 */
export function definitionModel(input: DefinitionInput): DefinitionNode[] {
  const nodes: DefinitionNode[] = []
  if (input.definition) {
    nodes.push({kind: 'definition', group: 'Definition', label: baseName(input.definition), file: input.definition, children: []})
  }
  for (const part of input.parts) {
    const group = (part.part[0]!.toUpperCase() + part.part.slice(1)) as DefinitionNode['group']
    const children: DefinitionNode[] = []
    if (part.part === 'comparator' && part.file && input.comparatorTests) {
      children.push({kind: 'tests', group, label: baseName(input.comparatorTests), file: input.comparatorTests, children: []})
    }
    if (part.part === 'renderer') {
      if (input.rendererSource && !part.docs) {
        children.push({kind: 'source', group, label: baseName(input.rendererSource), file: input.rendererSource, children: []})
      }
      for (const entry of input.scenarios ?? []) {
        const scenarios = typeof entry === 'string' ? {path: entry} : entry
        const directory = scenarios.directory ?? scenarios.path.split('/').slice(0, -1).join('/')
        children.push({
          kind: 'scenarios',
          group,
          label: 'Scenarios',
          value: directory || '.',
          file: scenarios.path,
          ...(scenarios.count !== undefined ? {count: scenarios.count} : {}),
          children: [],
        })
      }
    }
    nodes.push({
      kind: part.part,
      group,
      label: group,
      value: part.label,
      ...(part.file ? {file: part.file} : {}),
      ...(!part.file && part.docs ? {docs: part.docs} : {}),
      ...(part.part === 'comparator' && !part.file ? {command: 'projections.configureComparator'} : {}),
      children,
    })
  }
  if (input.environment) {
    nodes.push({
      kind: 'environment',
      group: 'Environment',
      label: 'Environment',
      value: baseName(input.environment),
      file: input.environment,
      children: [],
    })
  }
  return nodes
}

/**
 * The files behind a projection, for Go to Source…, in order: the definition model flattened. Its definition, the
 * extractor's script (or a built-in's bundled docs), the comparator file and its tests (or Configure… the default one, with
 * its docs), a custom renderer's source entry (or a built-in's bundled docs) and `scenarios.json`, and the environment.
 */
export function sourceItems(input: DefinitionInput): SourceItem[] {
  return flattenSources(definitionModel(input))
}

/** A definition model as Go to Source…'s entries: each node's file (or docs, or Configure…), then its children's files. */
export function flattenSources(nodes: readonly DefinitionNode[]): SourceItem[] {
  const file = (group: SourceItem['group'], path: string): SourceItem => ({group, label: baseName(path), description: path, file: path})
  return nodes.flatMap(node => {
    const own: SourceItem[] = node.file
      ? [file(node.group, node.file)]
      : node.command
        ? [
            {
              group: node.group,
              label: 'Default · Configure…',
              description: 'Configure it, or choose a comparator file',
              command: node.command,
              ...(node.docs ? {docs: node.docs} : {}),
            },
          ]
        : node.docs
          ? [
              {
                group: node.group,
                label: `${node.value} (built-in)`,
                description: 'Documentation',
                docs: node.docs,
              },
            ]
          : []
    return [...own, ...node.children.flatMap(child => (child.file ? [file(child.group, child.file)] : []))]
  })
}
