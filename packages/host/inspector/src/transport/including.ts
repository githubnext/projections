import type {InspectorTransport} from './contract.js'

/** `transport`, asking `GET /api/definitions` to list `projection` too: an explore candidate the Explore view opened. */
export function including(transport: InspectorTransport, projection: string): InspectorTransport {
  return {
    ...transport,
    origin: transport.origin,
    request(request) {
      if (!request.path.startsWith('/api/definitions')) return transport.request(request)
      const url = new URL(request.path, 'http://runner.invalid')
      url.searchParams.set('include', projection)
      return transport.request({...request, path: `${url.pathname}${url.search}`})
    },
    ...(transport.next ? {next: transport.next.bind(transport)} : {}),
  }
}
