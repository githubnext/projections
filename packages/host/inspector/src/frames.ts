/**
 * Custom renderer frames in a host whose frames may only be Blob documents (an editor webview). The Inspector loads a
 * repository's custom renderer bundle from `<runner origin>/custom-renderers/…`, which such a page can't load. So the
 * page relays those URLs: when a renderer frame's `src` is set to one, before the frame loads anything, `open` fetches
 * the bundle through the host and the frame gets a Blob document of it instead, with the same fragment (the renderer
 * protocol's channel). Built-in renderers are made Blob documents up front in the same way. Returns a function that stops relaying.
 */
export function relayRendererFrames(prefix: string, open: (url: URL) => Promise<string>, frame = globalThis.HTMLIFrameElement): () => void {
  const descriptor: TypedPropertyDescriptor<string> | undefined = Object.getOwnPropertyDescriptor(frame.prototype, 'src')
  if (!descriptor?.set || !descriptor.get) return () => {}
  const {get, set} = descriptor
  Object.defineProperty(frame.prototype, 'src', {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get,
    set(this: HTMLIFrameElement, value: string) {
      const text = String(value)
      if (!text.startsWith(prefix)) return set.call(this, value)
      const url = new URL(text)
      // Until the Blob document is ready the frame loads nothing; the renderer host times out if it never is.
      void open(url).then(
        blob => set.call(this, `${blob}${url.hash}`),
        error => console.error(`Projections: the custom renderer ${url.pathname} is unavailable`, error),
      )
    },
  })
  return () => Object.defineProperty(frame.prototype, 'src', descriptor)
}
