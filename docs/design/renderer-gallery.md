# Renderer gallery

Status: implemented (`renderer-scenarios`, `gallery`, and the `renderer-gallery`
projection).

## Goal

We want a projection of Projections' own built-in renderers — where each
renderer draws itself from synthetic data — that anyone can view without
granting local trust. It should also be reusable, so any repository with
renderers and scenarios gets the same gallery automatically.

## Design

The gallery is built from three reusable pieces, none of which runs repository
code:

1. **Data: the `renderer-scenarios` extractor.** It reads the committed
   `projections.scenarios` documents along with the fixtures they reference, and
   emits each scenario as a `graph/v0` entity under the `scenarios/v0`
   vocabulary. Each entity carries its renderer name plus either a normalized
   extraction or a before/after pair with its comparison. Because the extractor
   only reads files, it never needs trust.
2. **Comparisons: a service on the extractor SDK's `Context`.** Renderers in
   comparison mode need a comparison document, and extractor crates can only
   depend on the extractor SDK. To bridge that, the CLI supplies
   `Context::compare` to its built-in extractors (`with_comparisons`). It runs
   the default comparator module or the scenario's comparator file (read from
   the examined revision) inside the comparator runtime's sandbox and validates
   the result with the Engine, just like a normal projection. Comparator files
   are treated as data and never need trust. The service is optional: extractors
   that don't call it behave identically, and calling `compare` elsewhere fails
   with a clear message. Computing comparisons during extraction keeps the
   gallery self-contained, so CI artifacts, PNG exports, and every host can
   render it directly.
3. **Presentation: nested built-in renderers.** The `gallery` renderer asks its
   host for a built-in renderer's document by name via `document-request`. The
   host responds from its own registry (`document`), never accepting a URL or
   file path and rejecting custom or unknown names. The SDK's `embedRenderer`
   then mounts that document inside `<iframe sandbox="allow-scripts" srcdoc>`
   and hosts it.

## Why it keeps the trust model

- Built-in extractors that only read files never need trust. This extractor only
  reads files and runs comparisons inside the same sandbox comparator files
  already use.
- Renderer frames run under a sandbox policy that grants no external sources. A
  `srcdoc` frame inherits its parent's policy (`frame-src 'none'` does not block
  it in Chromium or WebKit) and gets its own opaque origin, so a nested renderer
  cannot do anything its parent renderer couldn't do.
- Hosts only serve built-in renderers, which are Projections' own code. No
  custom renderer runs nested, so nesting introduces no new code to trust, and
  the parent renderer only forwards data it was already given.

## Alternatives considered

- **Inlining every built-in renderer in the gallery bundle.** That would avoid a
  protocol addition, but it would add roughly 5 MB to both the CLI and the VS
  Code extension and lock the gallery to built-ins permanently. The request/
  response protocol pair leaves room for hosts to serve base-revision custom
  renderers later under the existing trust rules.
- **Having the host compute nested comparisons on demand.** That would expand
  the host protocol and restrict the gallery to hosts that bundle the Engine.
- **Skipping nested comparisons.** Most scenarios are comparisons, and showing
  change is the main job of most renderers.
