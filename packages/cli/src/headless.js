// The headless host page's script (see headless.rs): mounts the Inspector's bundle on the page's view (`snapshot`
// for --png, `stage` for check's renderer checks). The CLI answers every request of this page in-process, so its
// transport is plain same-origin fetch; nothing listens on a port.
import {InspectorRequestError, mountInspector, requestErrorMessage} from './mount.js'

const transport = {
  origin: location.origin,
  async request({method, path, body, signal, responseType}) {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      ...(signal ? {signal} : {}),
      ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
    })
    if (!response.ok) throw new InspectorRequestError(requestErrorMessage(response.status, await response.text()), response.status)
    return responseType === 'blob' ? response.blob() : response.json()
  },
}

mountInspector(document.getElementById('root'), {
  transport,
  view: new URLSearchParams(location.search).get('view'),
  search: location.search,
})
