import {createInterface} from 'node:readline'
import type {Readable, Writable} from 'node:stream'

/** A JSON-RPC 2.0 client over newline-delimited JSON: requests with ids, cancellation and notifications. */
export interface RpcClient {
  call: (method: string, params?: unknown, signal?: AbortSignal) => Promise<{result: unknown; size: number}>
  notify: (method: string, params?: unknown) => void
  onNotification: (listener: (method: string, params: unknown) => void) => () => void
  /** Fails every pending call; later calls fail at once. */
  close: (reason: string) => void
}

/** A JSON-RPC error the backend answered with, such as `-32800` (cancelled). */
export class RpcError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

/** Speaks JSON-RPC 2.0 with one message per line on `output` (to the backend) and `input` (from it). */
export function createRpcClient({input, output, log}: {input: Readable; output: Writable; log?: (line: string) => void}): RpcClient {
  let nextId = 1
  let closed: string | undefined
  const pending = new Map<number, {resolve: (value: {result: unknown; size: number}) => void; reject: (error: Error) => void}>()
  const listeners = new Set<(method: string, params: unknown) => void>()
  const write = (message: object) => {
    if (closed === undefined && output.writable) output.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  }
  createInterface({input, crlfDelay: Infinity}).on('line', line => {
    let message: {id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: {code?: unknown; message?: unknown}} | null
    try {
      message = JSON.parse(line)
    } catch {
      log?.(`The backend wrote a line that isn't JSON: ${line.slice(0, 200)}`)
      return
    }
    if (typeof message?.method === 'string') {
      for (const listener of listeners) listener(message.method, message.params)
      return
    }
    if (typeof message?.id !== 'number') {
      if (message?.error) log?.(`The backend reported: ${String(message.error.message)}`)
      return
    }
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.error) call.reject(new RpcError(String(message.error.message ?? 'Backend error'), Number(message.error.code)))
    else call.resolve({result: message.result, size: line.length})
  })
  return {
    call(method, params, signal) {
      if (closed !== undefined) return Promise.reject(new Error(closed))
      if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (!pending.delete(id)) return
          write({method: '$/cancelRequest', params: {id}})
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', abort, {once: true})
        pending.set(id, {
          resolve: value => {
            signal?.removeEventListener('abort', abort)
            resolve(value)
          },
          reject: error => {
            signal?.removeEventListener('abort', abort)
            reject(error)
          },
        })
        write({id, method, ...(params === undefined ? {} : {params})})
      })
    },
    notify(method, params) {
      write({method, ...(params === undefined ? {} : {params})})
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close(reason) {
      if (closed !== undefined) return
      closed = reason
      for (const call of pending.values()) call.reject(new Error(reason))
      pending.clear()
    },
  }
}
