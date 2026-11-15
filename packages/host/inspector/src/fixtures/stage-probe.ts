import type {ProbeCall} from '@githubnext/projections-renderer-testing'

/**
 * The check probe the Inspector injects into renderer documents in fixtures mode: a message channel to the renderer's
 * frame, and its measurements as requests over it.
 */
export class StageProbe {
  private port: Promise<MessagePort> | undefined
  private readonly requests = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>()
  private nextRequest = 1

  /** `target` is the ready renderer's window, or nothing before one is loaded. */
  constructor(private readonly target: () => Window | null | undefined) {}

  /** Forgets the channel; pending measurements fail. */
  reset(): void {
    this.port = undefined
    for (const request of this.requests.values()) request.reject(new Error('The renderer was unloaded'))
    this.requests.clear()
  }

  private connect(): Promise<MessagePort> {
    const target = this.target()
    if (!target) return Promise.reject(new Error('Load a renderer before measuring it'))
    const channel = new MessageChannel()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error('The check probe is unavailable: start the Inspector with --fixtures, which injects it into renderer documents'),
          ),
        3000,
      )
      channel.port1.onmessage = ({data}: MessageEvent<{id: number; result?: unknown; error?: string}>) => {
        if (data.id === 0) {
          clearTimeout(timer)
          resolve(channel.port1)
          return
        }
        const request = this.requests.get(data.id)
        if (!request) return
        this.requests.delete(data.id)
        if (data.error !== undefined) request.reject(new Error(data.error))
        else request.resolve(data.result)
      }
      target.postMessage({projectionsProbe: 0, type: 'connect'}, '*', [channel.port2])
    })
  }

  /** Runs a check-probe measurement inside the renderer document. */
  async measure<T = unknown>(call: ProbeCall, args?: unknown): Promise<T> {
    this.port ??= this.connect()
    let port: MessagePort
    try {
      port = await this.port
    } catch (error) {
      this.port = undefined
      throw error
    }
    const id = this.nextRequest++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id)
        reject(new Error(`The check probe didn't answer ${call}`))
      }, 10_000)
      this.requests.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      port.postMessage({id, call, args})
    })
  }
}
