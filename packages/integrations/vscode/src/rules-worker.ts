// The rules language service's worker: answers editor requests (`projections_rules_editor`) with rules-editor.wasm,
// compiled once and instantiated per request, so allocations go with each instance and typing never waits on it.
import {readFileSync} from 'node:fs'
import {parentPort, workerData} from 'node:worker_threads'

const exportName = 'projections_rules_editor'

interface Exports {
  memory: WebAssembly.Memory
  projections_alloc: (length: number) => number
  projections_rules_editor: (pointer: number, length: number) => bigint
}

/** Whether a compiled module has the language service. */
export function hasEditor(module: WebAssembly.Module): boolean {
  return WebAssembly.Module.exports(module).some(entry => entry.name === exportName && entry.kind === 'function')
}

/** Answers one request in a fresh instance of the language service: JSON in, JSON out. */
export function editorCall(module: WebAssembly.Module, request: unknown): unknown {
  const instance = new WebAssembly.Instance(module, {})
  const exports = instance.exports as unknown as Exports
  const input = new TextEncoder().encode(JSON.stringify(request))
  const pointer = exports.projections_alloc(input.length) >>> 0
  if (pointer === 0 && input.length > 0) throw new Error('The rules interpreter could not allocate the request')
  new Uint8Array(exports.memory.buffer, pointer, input.length).set(input)
  const packed = BigInt.asUintN(64, exports.projections_rules_editor(pointer, input.length))
  const start = Number(packed >> 32n)
  const length = Number(packed & 0xffff_ffffn)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, start, length)))
}

/** A message to the worker. */
export interface WorkerRequest {
  id: number
  request: unknown
}

/** The worker's answer. */
export type WorkerResponse = {id: number; ok: true; value: unknown} | {id: number; ok: false; message: string}

const data = workerData as {wasm?: unknown} | undefined
if (parentPort && typeof data?.wasm === 'string') {
  const port = parentPort
  let module: WebAssembly.Module | undefined
  let failure: string | undefined
  try {
    module = new WebAssembly.Module(readFileSync(data.wasm))
    if (!hasEditor(module)) failure = `This module has no ${exportName}`
  } catch (error) {
    failure = `The rules language service could not be loaded: ${error instanceof Error ? error.message : String(error)}`
  }
  port.on('message', ({id, request}: WorkerRequest) => {
    let response: WorkerResponse
    try {
      if (!module || failure) throw new Error(failure)
      response = {id, ok: true, value: editorCall(module, request)}
    } catch (error) {
      response = {id, ok: false, message: error instanceof Error ? error.message : String(error)}
    }
    port.postMessage(response)
  })
}
