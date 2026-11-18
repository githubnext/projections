# Renderer gallery

Status: implemented (`renderer-scenarios`, `gallery`, the `renderer-gallery`
projection).

## Goal

A projection of Projections' own built-in renderers, each drawn by itself inside
a projection, from synthetic data, so that viewing it needs no local trust; and
reusable, so any repository with renderers and scenarios gets the same gallery.

## Design

Three parts, each reusable, none of which runs repository code:

1. **Data: the `renderer-scenarios` extractor.** It reads the committed
   `projections.scenarios` documents and the fixtures they name, and writes each
   scenario as a `graph/v0` entity under the `scenarios/v0` vocabulary: its
   renderer and its normalized extraction, or before, after and their
   comparison. It only reads files, so it never needs trust.
2. **Comparisons: a service of the extractor SDK's `Context`.** A renderer in
   comparison mode needs a comparison document, and extractor crates may depend
   on nothing but the extractor SDK. The CLI provides `Context::compare` to its
   built-in extractors (`with_comparisons`): the default comparator module or
   the scenario's comparator file, read from the examined revision, run in the
   comparator runtime's sandbox and validated by the Engine, exactly as for a
   projection. Comparator files are data and never need trust. The service is
   optional: extractors that don't call it are unchanged, and elsewhere
   `compare` fails, saying so. Computing them at extraction makes the gallery's
   extraction self-contained, so CI artifacts, PNGs and every host draw it.
3. **Presentation: nested built-in renderers.** The `gallery` renderer asks its
   host for a built-in renderer's document by name (`document-request`); the
   host answers from its own registry (`document`), never taking a URL or path
   and refusing custom and unknown names. The SDK's `embedRenderer` runs the
   document in `<iframe sandbox="allow-scripts" srcdoc>` and hosts it.

## Why it keeps the trust model

- Built-in extractors that only read files never need trust; this one only reads
  files, and compares in the same sandbox comparator files always run in.
- Renderer frames are sandboxed with a policy that grants no source. A `srcdoc`
  frame inherits its parent's policy (`frame-src 'none'` doesn't stop it, in
  Chromium and WebKit) and gets an opaque origin of its own, so a nested
  renderer can do nothing its nesting renderer can't.
- Hosts supply only built-in renderers, which are Projections' own code: no
  custom renderer runs nested, so nesting adds no new code to trust. The nesting
  renderer passes on only data it was given.

## Alternatives considered

- **Inlining every built-in renderer in the gallery bundle**: no protocol
  change, but about 5 MB more in the CLI and the VS Code extension, and
  built-ins only for good. The protocol pair leaves room for hosts to supply
  base-revision custom renderers later, under the rule that already decides
  whether they run.
- **The host computing nested comparisons on request**: more protocol, and only
  hosts with the Engine could.
- **No nested comparisons**: most scenarios are comparisons, and renderers
  mostly draw change.
