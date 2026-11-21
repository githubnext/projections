// Counts of the extension's visible updates (tree refreshes, page loads, pair changes sent to tabs, extraction jobs),
// for tests that check one switch of the Viewing choice is one coalesced update. With PROJECTIONS_TEST_EVENT_LOG set,
// each is also appended to that file as a JSON line with its time, for tests driving VS Code from outside.
import {appendFileSync} from 'node:fs'

const log = process.env.PROJECTIONS_TEST_EVENT_LOG
const counts = new Map<string, number>()

/** Counts one `name` update. */
export function count(name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1)
  if (!log) return
  try {
    appendFileSync(log, `${JSON.stringify({t: Date.now(), name})}\n`)
  } catch {
    // A test's log is best effort.
  }
}

/** The counts so far, by name. */
export function counters(): Record<string, number> {
  return Object.fromEntries(counts)
}
