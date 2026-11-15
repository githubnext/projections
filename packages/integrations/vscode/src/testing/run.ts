import type * as vscode from 'vscode'
import type {Cases, Checks, TestState} from './state.js'

/** The request's leaves (checks and cases), each once: everything when it names nothing, less what it excludes. */
function leaves(state: TestState, request: vscode.TestRunRequest): vscode.TestItem[] {
  const excluded = new Set(request.exclude ?? [])
  const found: vscode.TestItem[] = []
  const visit = (item: vscode.TestItem) => {
    if (excluded.has(item)) return
    if (!item.children.size) {
      if (!found.includes(item)) found.push(item)
      return
    }
    item.children.forEach(visit)
  }
  for (const item of request.include ?? state.items().map(([, item]) => item)) visit(item)
  return found
}

/**
 * The request's checks (by projection) and comparator cases (by file and projection). The projections it includes run
 * whole: each of their checks reports, those a run adds too. Updating snapshots runs no checks.
 */
export function plan(state: TestState, request: vscode.TestRunRequest, update: boolean): {checks: Checks[]; cases: Cases[]} {
  const checks = new Map<string, Checks>()
  const cases = new Map<string, Cases>()
  const whole = new Set(
    (request.include ?? state.items().map(([, item]) => item)).flatMap(item => {
      const data = state.data.get(item)
      return data?.node.kind === 'projection' ? [`${data.folder.uri.toString()}|${data.node.projection}`] : []
    }),
  )
  for (const item of leaves(state, request)) {
    const data = state.data.get(item)
    if (!data) continue
    const {folder, node} = data
    if (node.kind === 'check' && node.projection && !update) {
      const key = `${folder.uri.toString()}|${node.projection}`
      const entry = checks.get(key) ?? {folder, projection: node.projection, whole: whole.has(key), items: []}
      entry.items.push(item)
      checks.set(key, entry)
    } else if (node.kind === 'case' && node.path) {
      const key = `${folder.uri.toString()}|${node.projection ?? ''}|${node.path}`
      const entry = cases.get(key) ?? {folder, ...(node.projection ? {projection: node.projection} : {}), path: node.path, items: []}
      entry.items.push(item)
      cases.set(key, entry)
    }
  }
  return {checks: [...checks.values()], cases: [...cases.values()]}
}
