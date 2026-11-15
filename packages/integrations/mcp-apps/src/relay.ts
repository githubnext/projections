// How the view reaches the viewer: every request of the viewer's page (its state's long poll and reports, the
// Inspector's reads and extraction jobs, renderer bundles) goes through `projections mcp`'s app-only tool
// `viewer_request`, which the host relays to the server. The view needs no network, loopback included, and never
// sees the viewer's token.
import {InspectorRequestError, requestErrorMessage} from '@githubnext/projections-inspector/transport'
import type {InspectorTransport} from '@githubnext/projections-inspector/transport'
import type {Host, RequestOptions} from './host.js'

/** The tool, `projections mcp` lists it only to MCP Apps hosts, which offer it only to the view. */
export const relayTool = 'viewer_request'

/**
 * The origin server-relative URLs the viewer returns resolve against (a custom renderer base): never fetched, only
 * recognised by `relayRendererFrames`, which relays those frames' bundles.
 */
export const viewerOrigin = 'https://projections-viewer.invalid'

/** The viewer's answer to one request. */
export interface Answer {
  status: number
  contentType: string
  body: unknown
}

/** A long answer's first part: the rest is asked for by `continuation` and part number. */
interface First {
  continuation: string
  parts: number
  text: string
}

const textOf = (result: {content?: {type: string; text?: string}[]}) =>
  result.content?.find(part => part.type === 'text' && typeof part.text === 'string')?.text

/** Calls the relay, and joins a long answer's parts. */
export async function relay(host: Host, args: Record<string, unknown>, options: RequestOptions = {}): Promise<Answer> {
  const call = async (input: Record<string, unknown>) => {
    const result = await host.callTool(relayTool, input, options)
    const text = textOf(result)
    if (result.isError || text === undefined) throw new Error(text ?? 'The viewer relay failed')
    return text
  }
  const text = await call(args)
  const value = JSON.parse(text) as Answer | First
  if (!('continuation' in value)) return value
  const parts = [value.text]
  for (let part = 1; part < value.parts; part++) parts.push(await call({continuation: value.continuation, part}))
  return JSON.parse(parts.join('')) as Answer
}

/** A binary body (`{"base64"}`) or text as a Blob of `type`. */
function blob(body: unknown, type: string): Blob {
  const base64 = (body as {base64?: unknown} | null)?.base64
  if (typeof base64 === 'string') return new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], {type})
  return new Blob([typeof body === 'string' ? body : JSON.stringify(body)], {type})
}

/** The Inspector's transport, and the viewer page's: each request relayed to the viewer. */
export function relayTransport(host: Host): InspectorTransport {
  return {
    origin: viewerOrigin,
    async request({method, path, body, signal, responseType}) {
      const answer = await relay(host, {method, path, ...(body === undefined ? {} : {body})}, {signal})
      if (answer.status < 200 || answer.status >= 300)
        throw new InspectorRequestError(requestErrorMessage(answer.status, answer.body), answer.status)
      return responseType === 'blob' ? blob(answer.body, answer.contentType) : answer.body
    },
  }
}

/** A custom renderer's bundle, relayed from the viewer, as a Blob document for its frame. */
export function customRenderers(host: Host): (url: URL) => Promise<string> {
  const documents = new Map<string, Promise<string>>()
  return url => {
    const path = `${url.pathname}${url.search}`
    let document = documents.get(path)
    if (!document) {
      document = relay(host, {method: 'GET', path}).then(answer => {
        if (answer.status !== 200) throw new Error(`The custom renderer ${url.pathname} answered ${answer.status}`)
        return URL.createObjectURL(blob(answer.body, 'text/html'))
      })
      documents.set(path, document)
      // A failed fetch is tried again the next time the frame opens.
      document.catch(() => documents.delete(path))
    }
    return document
  }
}
