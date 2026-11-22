import elk, {type ELK as ElkEngine} from 'elkjs/lib/elk-api.js'
import workerSource from 'elkjs/lib/elk-worker.min.js?raw'

interface WorkerLike {
  onmessage: ((event: {data: unknown}) => void) | null
  postMessage: (message: {id?: number}) => void
  /** ELK's in-document stand-in has none. */
  terminate?: () => void
}

/**
 * Runs ELK in the document itself: the worker source, injected as an inline
 * script (the renderer policy allows inline scripts, never `eval`), exports
 * ELK's in-document worker stand-in instead of listening on `self`.
 */
function inlineWorker(): WorkerLike {
  const global = globalThis as {projectionsElkWorker?: new () => WorkerLike}
  if (!global.projectionsElkWorker) {
    const script = document.createElement('script')
    script.textContent = `(function(){var module={exports:{}},exports=module.exports;\n${workerSource}\n;globalThis.projectionsElkWorker=module.exports.Worker})()`
    document.head.append(script)
    script.remove()
  }
  if (!global.projectionsElkWorker) throw new Error('The graph layout engine could not start')
  return new global.projectionsElkWorker()
}

/**
 * A dedicated Worker from a `blob:` URL (the renderer policy's `worker-src`).
 * If the browser refuses it, synchronously or with an `error` event,
 * unanswered messages are replayed in the document instead, so layout never
 * hangs. Both paths run the same ELK code and produce the same geometry.
 */
class LayoutWorker implements WorkerLike {
  onmessage: ((event: {data: unknown}) => void) | null = null
  private target: WorkerLike
  private readonly pending = new Map<number, {id?: number}>()
  private inDocument = false

  constructor() {
    try {
      const url = URL.createObjectURL(new Blob([workerSource], {type: 'text/javascript'}))
      const worker = new Worker(url)
      worker.onmessage = event => this.receive(event)
      worker.onerror = event => {
        event.preventDefault()
        this.fallBack()
      }
      this.target = {onmessage: null, postMessage: message => worker.postMessage(message), terminate: () => worker.terminate()}
    } catch {
      this.target = this.inline()
    }
  }

  private inline(): WorkerLike {
    this.inDocument = true
    const worker = inlineWorker()
    worker.onmessage = event => this.receive(event)
    return worker
  }

  private receive(event: {data: unknown}) {
    const id = (event.data as {id?: number} | null)?.id
    if (id !== undefined) this.pending.delete(id)
    this.onmessage?.(event)
  }

  private fallBack() {
    if (this.inDocument) return
    this.target.terminate?.()
    this.target = this.inline()
    for (const message of [...this.pending.values()]) this.target.postMessage(message)
  }

  postMessage(message: {id?: number}) {
    if (message.id !== undefined) this.pending.set(message.id, message)
    this.target.postMessage(message)
  }

  terminate() {
    this.target.terminate?.()
  }
}

// CommonJS: `module.exports` is the constructor, also exposed as `default`.
/** ELK's layered algorithm, off the main thread where the browser allows it. */
export function createLayoutEngine(): ElkEngine {
  return new elk.default({algorithms: ['layered'], workerFactory: () => new LayoutWorker() as unknown as Worker})
}
