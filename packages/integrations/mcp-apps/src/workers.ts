// Classic Workers for the engine and the comparator runtime. Chromium refuses a module Worker started from a Blob URL
// in an opaque-origin document, and a host's sandbox makes the view one (Claude's `srcdoc` frame without
// `allow-same-origin`); it starts classic ones. The engine and the runtime start their Workers as modules, so the view
// starts the Blob URLs it made from its own single-script Workers (scripts/build.mjs) as classic Workers instead.

/** Starts the Workers at `urls` as classic Workers, whatever type their creator asks for. */
export function classicWorkers(urls: readonly string[]) {
  const classic = new Set(urls)
  const Native = globalThis.Worker
  globalThis.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, classic.has(String(url)) ? {...options, type: 'classic'} : options)
    }
  }
}
