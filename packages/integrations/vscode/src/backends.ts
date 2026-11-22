import type {Runner} from './runner.js'
import {noop} from './noop.ts'

/** A holder's use of a shared backend: the current runner, told when it is replaced, released when done. */
export interface Lease {
  /** The backend, started if it isn't running (or was stopped, or exited). */
  current: () => Promise<Runner>
  /** Called after the backend is replaced (a restart, or a new one after it exited), with the new runner. */
  onDidChange: (listener: (runner: Runner) => void) => () => void
  /** Releases it; the backend stops once nothing holds it. */
  dispose: () => void
}

interface Entry<S> {
  source: S
  runner?: Promise<Runner> | undefined
  /** Whether a runner was started before, so the next start is a replacement holders hear about. */
  started: boolean
  holders: number
  listeners: Set<(runner: Runner) => void>
}

/**
 * One `projections serve --stdio` backend per source (a workspace folder, a saved document, a scenarios directory),
 * shared by everything that uses it: the Inspector panel, the comparator test view and one-off commands. A backend
 * starts on first use, is replaced on `restart` (workspace trust granted) or after it exits, and stops when its last
 * holder releases it.
 */
export class BackendPool<S> {
  private readonly entries = new Map<string, Entry<S>>()
  private readonly start: (source: S) => Promise<Runner>
  private readonly key: (source: S) => string
  private readonly log: (line: string) => void

  constructor(start: (source: S) => Promise<Runner>, key: (source: S) => string, log: (line: string) => void = noop) {
    this.start = start
    this.key = key
    this.log = log
  }

  lease(source: S): Lease {
    const key = this.key(source)
    let entry = this.entries.get(key)
    if (!entry) this.entries.set(key, (entry = {source, started: false, holders: 0, listeners: new Set()}))
    const held = entry
    held.holders++
    const own = new Set<(runner: Runner) => void>()
    let released = false
    return {
      current: () => (released ? Promise.reject(new Error('The backend was released')) : this.current(held)),
      onDidChange: listener => {
        own.add(listener)
        held.listeners.add(listener)
        return () => {
          own.delete(listener)
          held.listeners.delete(listener)
        }
      },
      dispose: () => {
        if (released) return
        released = true
        for (const listener of own) held.listeners.delete(listener)
        if (--held.holders > 0) return
        this.entries.delete(key)
        void held.runner?.then(runner => runner.stop(), noop)
        held.runner = undefined
      },
    }
  }

  /** Whether a source's backend is held (running or starting). */
  held(source: S): boolean {
    return this.entries.has(this.key(source))
  }

  private current(entry: Entry<S>): Promise<Runner> {
    if (entry.runner) return entry.runner
    const replacing = entry.started
    entry.started = true
    const starting = this.start(entry.source)
    entry.runner = starting
    starting.then(
      runner => {
        // A backend that exits is started again on next use.
        void runner.exited.then(() => {
          if (entry.runner === starting) entry.runner = undefined
        })
        if (replacing) for (const listener of [...entry.listeners]) listener(runner)
      },
      () => {
        // A backend that failed to start is tried again on next use.
        if (entry.runner === starting) entry.runner = undefined
      },
    )
    return starting
  }

  /** Replaces the running backends of the sources `which` selects, for example with `--trust` once the workspace is trusted. */
  async restart(which: (source: S) => boolean, reason: string): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter(entry => entry.runner && which(entry.source))
        .map(async entry => {
          this.log(`${reason}; restarting the Projections backend`)
          const previous = entry.runner
          entry.runner = undefined
          void previous?.then(runner => runner.stop(), noop)
          await this.current(entry).catch(noop)
        }),
    )
  }

  /** Stops every backend. */
  dispose() {
    for (const entry of this.entries.values()) {
      void entry.runner?.then(runner => runner.stop(), noop)
    }
    this.entries.clear()
  }
}
