# Projections host guide

The browser host presents one extraction, or a comparison of two, through
renderer bundles in sandboxed frames. It comes in three layers:

<!-- prettier-ignore -->
| Layer | Package | What it is |
|---|---|---|
| Headless core | `@githubnext/projections-host` | State, actions and renderer frames. It owns everything that must be correct and secure, and renders no controls. |
| Default UI | `@githubnext/projections-host/ui` | `ProjectionView` and `ComparisonExplorer` built on the core with shadcn/ui, scoped so embedding pages and the UI don't affect each other. Used by the Inspector and third-party embedders. |

Hosts choose which features to expose. A host can offer side by side only and no
play button, or draw every control with its own design system.

This guide explains each layer and how to embed it. The package's
[README](../../packages/host/core/README.md) lists its entry points, and the
[guide's embedding section](embedding.md#embedding-projections-in-your-own-app)
shows where the host fits in an application.

## Layers

Each layer has its own page:

- [The host's headless core](host-core.md): state, actions, targets, annotations
  and settings.
- [The host's default UI](host-ui.md): `ProjectionView`, `ComparisonExplorer`
  and the layer-2 blocks.

## Renderer frames

`RendererFrame` implements the host side of the
[renderer frame protocol](renderer-sdk.md#protocol):

- It creates
  `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer" aria-label="<Renderer> renderer">`.
  The name is an `aria-label`, not a `title`, which browsers would show as a
  tooltip over the whole frame. It never sets `allow-same-origin`, so the
  renderer runs in an opaque origin with no access to the host's DOM, storage or
  cookies.
- Each frame gets a fresh 192-bit channel nonce, sent in the URL fragment
  together with the host origin and color mode. A message is accepted only if
  all of the following hold; otherwise it is dropped:
  - `event.source` is that frame's window and `event.origin` is `"null"`.
  - It carries the protocol tag and channel.
  - It validates strictly: known type, no unknown fields, values in range.
  - It is no larger than 64 KiB, and the frame is within 240 messages per
    second.
- A frame that becomes non-opaque is stopped. So is one that isn't ready within
  10 s, loads a second document (navigates), or exceeds the rate limit tenfold.
  The alert keeps the table and text views one click away.
- Progress is flow-controlled. At most one progress value is unacknowledged;
  newer values replace a pending one and are sent on `rendered`, or after a 1 s
  acknowledgement timeout.

### Serving renderer bundles

Renderer bundles are single documents: `index.html` and `renderer.json`, with
the `THIRD_PARTY_NOTICES.txt` the SDK build writes beside them. Serve each
bundle's `index.html` with this policy as a response header. It is exported as
`rendererContentSecurityPolicy` from the package and from the SDK protocol, and
as `rendererResponseHeaders(path)` from `@githubnext/projections-host/build`:

```
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none';
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts
```

The policy grants no source at all, not even `'self'`. A renderer can't fetch,
load or prefetch anything, including files from its own bundle. Don't send
`X-Frame-Options: DENY` or `frame-ancestors 'none'` on renderer documents. The
host page itself needs `frame-src 'self'` (or the renderer origin).

`collectRenderers({packages, outDir, from})` from
`@githubnext/projections-host/build` copies built bundles into
`<outDir>/renderers/<name>/` and writes `<outDir>/renderers/index.json`
(`{"format":"projections.renderers","version":0,"renderers":[manifest…]}`) and
`<outDir>/renderers/THIRD_PARTY_NOTICES.txt` (every bundle's notices, each
package version once). It fails for a bundle without notices.
`rendererNotices({packages, from, exclude})` returns the same merged notices for
an application's own `THIRD_PARTY_NOTICES.txt`; the Inspector (and so
`projections licenses`) include them. `loadRendererCatalog({base})` reads that
catalog. With `loadRendererCatalog({base, names})` it reads each
`<base><name>/renderer.json` instead.

A definition's renderer string matches a bundle with that exact `name` first,
then the first bundle whose `handles` includes it. A custom renderer
(`{"bundle": …}`) needs an entry from the embedding application
(`customRenderer(manifest, url)`). An application that withholds one, for
example because it needs trust that wasn't granted, passes `{withheld: reason}`
instead. Without a custom entry, the built-in renderer for the extraction's
schema (`resolveRenderer(requested, catalog, custom, schema)`) is used. If
nothing matches, the host says so and shows the table.

`ProjectionView` and `ComparisonExplorer` display `notices`, for example those
of a saved comparison document.

## Contracts with the native CLI

The Inspector UI (`packages/host/inspector/`) uses these. The CLI documents its
side in `docs/runner.md`.

**Inspector service.** The CLI answers these paths in memory, with no listener:
for the VS Code extension through `projections serve --stdio` (its `request`
method), and in its own headless pages (`--png`, `check`).

<!-- prettier-ignore -->
| Route | Use |
|---|---|
| `GET /api/revisions[?limit=N]` | `{"revisions":[{"ref","commit","title","kind":"working-tree|commit","dirty"?,"date"?}]}` (working tree first) |
| `POST /api/jobs {projectionId, before, definitionRevision?}` | One extraction per job (`job.extraction`). The Inspector applies one `definitionRevision` to every extraction so their digests match. |
| `GET /api/comparator?projection=<id>[&ref=<definition revision>]` | `{"default": true}` or `{"rules": "<base64>", "digest": "sha256:<hex>"}` for `loadComparator`; `?rules=<path>` returns any comparator file (`*.comparator.yaml`) the same way |
| `GET /api/renderers` | Optional: `{"renderers": [names], "customRendererBase"?: "<prefix>"}`. A custom renderer for projection P is at `<prefix><P>/index.html?ref=<definition revision>`. |
| `GET /renderers/<name>/index.html`, `renderer.json`, `index.json` | Built-in bundles from the Inspector's embedded assets, sent with the renderer policy |

The Inspector's assets also include `packages/engine/` (engine and default
comparator Wasm and Worker) and `comparator/` (comparator runtime Worker:
`worker-entry.js`, `execute.js`, `abi.js`) as same-origin scripts. The page
policy needs `script-src 'self' 'wasm-unsafe-eval'` and `frame-src 'self'` (or
`default-src 'self'`).

**Fixtures mode** (`projections serve --stdio --fixtures`) adds
`GET /api/fixtures` (validated scenarios, inline extractions and renderer
bundles served at `/custom-renderers/<capability>/fixtures/<key>/index.html`)
and `GET /api/fixtures/changes?since=<generation>` (a long poll that returns
when a watched file changes). Comparisons are computed in the browser with
`compareExtractions`, which runs the default comparator with options, or a
comparator file in the rules runtime, without definition checks.
