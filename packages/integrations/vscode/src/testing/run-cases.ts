import type * as vscode from 'vscode'
import {outcomes} from '../comparator-tests/outcomes.js'
import {parseResults, refusalMessage} from '../comparator-tests/parse.js'
import {runPath} from '../comparator-tests/wire.js'
import type {Cases, TestState} from './state.js'

type FileOutcome = NonNullable<ReturnType<ReturnType<typeof outcomes>['get']>>

/** A file's errors: on its file item when the cases are under one, else on each case. */
function reportErrors(state: TestState, run: vscode.TestRun, entry: Cases, outcome: FileOutcome) {
  const parent = entry.items[0]?.parent
  for (const item of parent && state.data.get(parent)?.node.kind === 'file' ? [parent] : entry.items) {
    run.errored(
      item,
      outcome.errors.map(error => state.message(entry.folder, error)),
    )
    state.record(item, 'errored', outcome.errors)
  }
}

/** Each case's outcome; a case without a result is skipped, unless the file errored. */
function reportCases(state: TestState, run: vscode.TestRun, entry: Cases, outcome: FileOutcome) {
  for (const item of entry.items) {
    const result = outcome.cases.get(state.data.get(item)?.node.case ?? '')
    if (!result) {
      if (!outcome.errors.length) {
        run.skipped(item)
        state.record(item, 'skipped')
      }
      continue
    }
    if (result.status === 'passed') run.passed(item, result.durationMs)
    else if (result.status === 'failed')
      run.failed(
        item,
        result.messages.map(message => state.message(entry.folder, message)),
        result.durationMs,
      )
    else {
      for (const message of result.messages) run.appendOutput(`${item.label}: ${message.message}\r\n`, undefined, item)
      run.skipped(item)
    }
    state.record(item, result.status, result.messages)
  }
}

/** One `POST /api/comparator-tests/run` for a file's chosen cases (for one projection, or none): each case's outcome. */
export async function runCases(state: TestState, run: vscode.TestRun, entry: Cases, update: boolean, signal: AbortSignal) {
  const watched = state.watched.get(entry.folder.uri.toString())
  if (!watched) return
  const listed = watched.files.find(file => file.path === entry.path)
  const chosen = entry.items.map(item => state.data.get(item)?.node.case ?? '')
  const whole = listed && chosen.length === listed.cases.length
  const body = {
    path: entry.path,
    ...(whole ? {} : {cases: chosen}),
    ...(entry.projection ? {projection: entry.projection} : {}),
    ...(update ? {update: true} : {}),
  }
  const fail = (message: string) => state.errored(run, entry.items, message)
  try {
    const runner = await watched.lease.current()
    const response = await runner.request({method: 'POST', path: runPath, body}, signal)
    if (response.status !== 200) return fail(refusalMessage(response.status, response.body))
    const outcome = outcomes(parseResults(response.body)).get(entry.path)
    if (!outcome) return fail(`No results for ${entry.path}`)
    if (outcome.written.length) run.appendOutput(`Wrote ${outcome.written.join(', ')}\r\n`)
    if (outcome.errors.length) reportErrors(state, run, entry, outcome)
    reportCases(state, run, entry, outcome)
  } catch (error) {
    if (signal.aborted) {
      for (const item of entry.items) {
        run.skipped(item)
        state.record(item, 'skipped')
      }
      return
    }
    fail(error instanceof Error ? error.message : String(error))
  }
}
