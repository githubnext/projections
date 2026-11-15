/*
 * When a running job's indicator shows: not for a short job, which would only flash, and, once shown, long enough to
 * read. The summary bar's spinner and the VS Code extension's status bar item follow the same rule. Nothing here
 * imports React or the DOM, so the extension host can import it (`@githubnext/projections-host-vscode/running`).
 */

/** What a projection tab is doing: extracting a side of its pair, or comparing the two. */
export type Running = 'extracting' | 'comparing'

/** How long a job runs before its indicator shows. */
export const runningDelayMs = 300
/** How long the indicator stays once shown, however soon the job ends. */
export const runningMinimumMs = 400

/** What a job says it is doing, in an indicator's tooltip and accessible text: "Extracting…" or "Comparing…". */
export const runningText = (running: Running) => (running === 'extracting' ? 'Extracting…' : 'Comparing…')

/**
 * The clock and timers `runningIndicator` uses, so a test can drive them: `now` in milliseconds, `set` schedules `run`
 * after `ms` milliseconds and returns a handle that `clear` cancels. Defaults to `Date.now` and `setTimeout`.
 */
export interface RunningTimers {
  now(): number
  set(run: () => void, ms: number): unknown
  clear(timer: unknown): void
}
const realTimers: RunningTimers = {
  now: () => Date.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

/**
 * An indicator of a running job: `set` it to what the job does (or `undefined` once it ends) as often as that is known;
 * `current` is what to show. It shows `delayMs` after a job starts, so a shorter job never shows it, and once shown it
 * stays at least `minimumMs`, so a job that ends soon after doesn't flash it either. A job that starts again while it
 * is still shown keeps it shown. `set` changes `current` at once where it can (a new kind of work while shown, or the
 * end after the minimum); the delay and the minimum end in `onChange`, called from a timer, never from `set`.
 */
export function runningIndicator(
  onChange: () => void,
  {
    delayMs = runningDelayMs,
    minimumMs = runningMinimumMs,
    timers = realTimers,
  }: {delayMs?: number; minimumMs?: number; timers?: RunningTimers} = {},
) {
  let shown: Running | undefined
  let latest: Running | undefined
  let since = 0
  // While nothing is shown, the pending show; while shown, the pending hide.
  let timer: unknown
  let pending = false
  const cancel = () => {
    if (pending) timers.clear(timer)
    pending = false
  }
  const schedule = (ms: number, run: () => void) => {
    cancel()
    pending = true
    timer = timers.set(() => {
      pending = false
      run()
      onChange()
    }, ms)
  }
  return {
    get current(): Running | undefined {
      return shown
    },
    set(running: Running | undefined) {
      latest = running
      if (running) {
        if (shown) {
          cancel()
          shown = running
        } else if (!pending)
          schedule(delayMs, () => {
            shown = latest
            since = timers.now()
          })
        return
      }
      if (!shown) return cancel()
      const left = since + minimumMs - timers.now()
      if (left <= 0) {
        cancel()
        shown = undefined
      } else if (!pending) schedule(left, () => (shown = undefined))
    },
    /** Shows nothing and forgets the job, as for another tab's. */
    reset() {
      cancel()
      shown = latest = undefined
    },
    dispose() {
      cancel()
    },
  }
}
