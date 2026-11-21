// Serves the built Storybook (storybook-static/) as a production host would: a strict page policy, the renderer
// policy on renderer bundles and a probe log of requests a sandboxed renderer must never be able to make.
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, normalize, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {rendererResponseHeaders} from '@githubnext/projections-host/build'

export const storybookDirectory = fileURLToPath(new URL('../storybook-static/', import.meta.url))

/**
 * The page policy a production host would send: frames only from this origin. Storybook's pages carry a few inline
 * scripts, which are allowed by their hashes only.
 */
export function hostContentSecurityPolicy(inlineScripts = []) {
  const hashes = inlineScripts.map(script => ` 'sha256-${createHash('sha256').update(script).digest('base64')}'`).join('')
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

/** The bodies of a page's inline `<script>` elements (those without `src`). */
const inlineScripts = html => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean)

/** Serves the built Storybook on a loopback port; `close` stops it. */
export async function startStorybookServer({root = storybookDirectory, port = 0} = {}) {
  const base = resolve(root)
  const probes = []
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/__probe/')) {
        probes.push(`${request.method} ${url.pathname}`)
        response.writeHead(204)
        response.end()
        return
      }
      if (url.pathname === '/__probe-log') {
        response.writeHead(200, {'content-type': 'application/json'})
        response.end(JSON.stringify(probes))
        return
      }
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      const path = normalize(resolve(base, `.${relative}`))
      if (!path.startsWith(base + sep) || request.method !== 'GET') {
        response.writeHead(404)
        response.end()
        return
      }
      const bytes = await readFile(path)
      if (relative.startsWith('/renderers/') || relative.startsWith('/test-renderers/')) {
        response.writeHead(200, rendererResponseHeaders(path))
      } else {
        response.writeHead(200, {
          'content-type': types[extname(path)] ?? 'application/octet-stream',
          'content-security-policy': hostContentSecurityPolicy(extname(path) === '.html' ? inlineScripts(bytes.toString('utf8')) : []),
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        })
      }
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise(done => {
    server.listen(port, '127.0.0.1', done)
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise(done => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {url} = await startStorybookServer({port: Number(process.argv[2] ?? 0)})
  console.log(`Built Storybook: ${url}`)
}
