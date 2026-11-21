import {createWasmTransport} from './wasm-transport.js'
import {createComparatorTransport} from './comparator-transport.js'
import type {DefaultComparator} from './transport.js'

let invoke: ((input: Uint8Array) => Uint8Array) | undefined
let comparator: DefaultComparator | undefined
let initializing = false
globalThis.addEventListener('message', async (event: MessageEvent<unknown>) => {
  try {
    const message = event.data
    if (message === null || typeof message !== 'object' || !('type' in message)) {
      throw new Error('Invalid engine worker request')
    }
    if (message.type === 'init' && !initializing) {
      initializing = true
      if (!('options' in message) || message.options === null || typeof message.options !== 'object') {
        throw new Error('Invalid engine worker configuration')
      }
      if ('module' in message.options) {
        const module = message.options.module
        if (!(module instanceof WebAssembly.Module) && !(module instanceof ArrayBuffer) && !ArrayBuffer.isView(module)) {
          throw new TypeError('Invalid engine worker Wasm module')
        }
        invoke = await createWasmTransport({module})
      } else if ('url' in message.options) {
        if (typeof message.options.url !== 'string') throw new TypeError('Invalid engine worker Wasm URL')
        invoke = await createWasmTransport({url: message.options.url})
      } else {
        invoke = await createWasmTransport({})
      }
      if (!('comparator' in message) || message.comparator === null || typeof message.comparator !== 'object') {
        throw new Error('Invalid engine worker comparator configuration')
      }
      if ('module' in message.comparator) {
        const module = message.comparator.module
        if (!(module instanceof ArrayBuffer) && !ArrayBuffer.isView(module)) throw new TypeError('Invalid comparator module bytes')
        comparator = await createComparatorTransport({module: module as BufferSource})
      } else if ('url' in message.comparator) {
        if (typeof message.comparator.url !== 'string') throw new TypeError('Invalid comparator module URL')
        comparator = await createComparatorTransport({url: message.comparator.url})
      } else {
        comparator = await createComparatorTransport({})
      }
      globalThis.postMessage({type: 'ready', digest: comparator.digest})
      return
    }
    if (
      (message.type !== 'request' && message.type !== 'compare') ||
      !invoke ||
      !comparator ||
      !('id' in message) ||
      !Number.isSafeInteger(message.id) ||
      !('bytes' in message) ||
      !(message.bytes instanceof Uint8Array)
    ) {
      throw new Error('Invalid engine worker request')
    }
    const bytes = message.type === 'request' ? invoke(message.bytes) : await comparator.call(message.bytes)
    globalThis.postMessage({type: 'response', id: message.id, bytes}, {transfer: [bytes.buffer]})
  } catch (error) {
    globalThis.postMessage({type: 'failure', message: error instanceof Error ? error.message : String(error)})
  }
})
