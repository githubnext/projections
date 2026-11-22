import * as vscode from 'vscode'
import {checkItem, checkOutcomes, defaultChecks, type CheckStep} from '../test-items.js'
import type {Checks, TestState, Watched} from './state.js'

/** `projections check` for one projection, through the tools layer: its steps. */
async function checkSteps(watched: Watched, projection: string, signal: AbortSignal): Promise<CheckStep[]> {
  const runner = await watched.lease.current()
  const result = await runner.callTool('check', {projections: [projection]}, signal)
  const report = result.structuredContent as {projections?: {steps?: {[K in keyof CheckStep]?: unknown}[]}[]} | undefined
  const listed = report?.projections?.[0]?.steps
  if (!listed) throw new Error(result.content.map(part => part.text ?? '').join('\n') || 'The check reported nothing')
  return listed.map(step => {
    const said = Boolean(step.message)
    return {
      id: String(step.id ?? ''),
      title: String(step.title ?? step.id ?? ''),
      status: String(step.status ?? ''),
      ...(said ? {message: String(step.message)} : {}),
    }
  })
}

/** The check items that report: the included ones, and every check of a projection that runs whole. */
function reportingItems(state: TestState, run: vscode.TestRun, entry: Checks): vscode.TestItem[] {
  const items = [...entry.items]
  if (entry.whole) {
    state.controller.items.get(`${entry.folder.uri.toString()}|projection:${entry.projection}`)?.children.forEach(child => {
      if (state.data.get(child)?.node.kind === 'check' && !items.includes(child)) {
        items.push(child)
        run.started(child)
      }
    })
  }
  return items
}

/** `projections check` for one projection, through the tools layer: each included check's outcome. */
export async function runChecks(
  state: TestState,
  run: vscode.TestRun,
  entry: Checks,
  signal: AbortSignal,
  apply: (watched: Watched) => Promise<void>,
) {
  const watched = state.watched.get(entry.folder.uri.toString())
  if (!watched) return
  let steps: CheckStep[]
  try {
    steps = await checkSteps(watched, entry.projection, signal)
  } catch (error) {
    if (!signal.aborted) state.errored(run, entry.items, error instanceof Error ? error.message : String(error))
    return
  }
  // A step the defaults don't list (a comparison with HEAD, say) becomes an item from now on, unless it was skipped.
  watched.reported.set(
    entry.projection,
    steps.filter(step => step.status !== 'skip' || defaultChecks.includes(checkItem(step.id))).map(step => step.id),
  )
  await apply(watched)
  const items = reportingItems(state, run, entry)
  const found = checkOutcomes(
    steps,
    items.map(item => state.data.get(item)?.node.check ?? ''),
  )
  for (const item of items) {
    const outcome = found.get(state.data.get(item)?.node.check ?? '')
    if (!outcome) continue
    const text = outcome.messages.join('\n')
    if (outcome.state === 'failed') {
      run.failed(item, new vscode.TestMessage(text))
      state.record(item, 'failed', [{message: text}])
      continue
    }
    if (text) run.appendOutput(`${outcome.warning ? 'Warning: ' : ''}${item.label}: ${text.replace(/\n/gu, '\r\n')}\r\n`, undefined, item)
    if (outcome.state === 'passed') run.passed(item)
    else run.skipped(item)
    state.record(item, outcome.state, text ? [{message: text}] : [])
  }
}
