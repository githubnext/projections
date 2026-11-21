import * as vscode from 'vscode'
import type {TestNode} from '../test-items.js'
import type {TestState} from './state.js'

export interface DescribedItem {
  id: string
  label: string
  kind?: string
  path?: string
  line?: number
  error?: string
  children: unknown[]
}

/** What a test item shows, with its children, for tests. */
function describe(state: TestState, item: vscode.TestItem): DescribedItem {
  const node = state.data.get(item)?.node
  const children: vscode.TestItem[] = []
  item.children.forEach(child => children.push(child))
  return {
    id: item.id,
    label: item.label,
    ...(node ? {kind: node.kind} : {}),
    ...(node?.path ? {path: node.path} : {}),
    ...(item.range ? {line: item.range.start.line + 1} : {}),
    ...(item.error ? {error: typeof item.error === 'string' ? item.error : item.error.value} : {}),
    children: children.map(child => describe(state, child)),
  }
}

/** The outermost items whose nodes match. */
function find(state: TestState, predicate: (node: TestNode) => boolean): vscode.TestItem[] {
  const found: vscode.TestItem[] = []
  const visit = (item: vscode.TestItem) => {
    const node = state.data.get(item)?.node
    if (node && predicate(node)) found.push(item)
    else item.children.forEach(visit)
  }
  for (const [, item] of state.items()) visit(item)
  return found
}

export interface RunOptions {
  update?: boolean
  projection?: string
  checks?: string[]
  path?: string
  cases?: string[]
}

/** The items a run includes: a projection (its checks and cases), a projection's checks, a test file or its cases. */
function included(state: TestState, {projection, checks, path, cases}: RunOptions): vscode.TestItem[] | undefined {
  if (projection !== undefined) {
    const include = checks
      ? find(state, node => node.kind === 'check' && node.projection === projection && checks.includes(node.check ?? ''))
      : find(state, node => node.kind === 'projection' && node.projection === projection)
    if (!include.length) throw new Error(`No tests for ${projection}`)
    return include
  }
  if (path === undefined) return undefined
  const [file] = find(state, node => node.kind === 'file' && node.path === path)
  if (!file) throw new Error(`No test file ${path}`)
  return cases ? cases.flatMap(id => (file.children.get(`case:${path}#${id}`) ? [file.children.get(`case:${path}#${id}`)!] : [])) : [file]
}

/** For tests: the items, the last outcomes, and running through a profile as the Testing view does. */
export function testsApi(
  state: TestState,
  scan: () => Promise<void>,
  profiles: () => {run: vscode.TestRunProfile; update: vscode.TestRunProfile | undefined},
) {
  return {
    controller: () => ({id: state.controller.id, label: state.controller.label}),
    refresh: scan,
    items: () => state.items().map(([, item]) => describe(state, item)),
    outcomes: () => Object.fromEntries(state.recorded),
    profiles: () => {
      const {run, update} = profiles()
      return [run, ...(update ? [update] : [])].map(profile => profile.label)
    },
    /**
     * Runs as the Testing view does: everything, a projection (its checks and cases), a projection's checks, or a
     * test file (or some of its cases) used by no projection.
     */
    run: async (options: RunOptions = {}) => {
      const profile = options.update ? profiles().update : profiles().run
      if (!profile) throw new Error('Updating snapshots needs a trusted workspace')
      const include = included(state, options)
      const source = new vscode.CancellationTokenSource()
      try {
        await profile.runHandler(new vscode.TestRunRequest(include, undefined, profile), source.token)
      } finally {
        source.dispose()
      }
      return Object.fromEntries(state.recorded)
    },
  }
}
