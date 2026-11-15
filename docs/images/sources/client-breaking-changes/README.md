---
description: "A TypeScript client library before and after a breaking release, for the gallery's API image"
---

# Client breaking changes

The [gallery](../../../../docs/gallery.md#public-api)'s API image.

`src/index.ts` declares a small HTTP client. In `after`, `createClient` takes an
options object, `search` and `withRetry` are gone and `Response` gains a
required `headers`. The
[`typescript-public-api`](../../../../docs/builtins/extractors/typescript-public-api.md)
extractor reads it with TypeScript, and the
[API compatibility comparator](../../../../packages/comparators/api-compatibility/README.md)
says which changes break callers.
`node tools/scripts/readme-images.mjs --only api` commits `before` and `after`
as two revisions and draws the images.
