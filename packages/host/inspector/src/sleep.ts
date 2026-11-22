/** Resolves after `ms`, or as soon as `signal` aborts, leaving no timer behind. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    // An abort before the call has already fired: its listeners would never hear it.
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, {once: true})
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
