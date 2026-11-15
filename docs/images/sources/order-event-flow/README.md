---
description: "A small TypeScript event-driven shop before and after payments become an event, for the gallery's architecture images"
---

# Order event flow

The [gallery](../../../../docs/gallery.md#architecture)'s architecture images.

Four packages subscribe to and publish events on `@shop/bus`. In `before`,
billing, email and stock all handle `order.placed`; in `after`, billing captures
the payment and publishes `payment.captured`, which shipping and a new
notifications package handle. The
[`message-handlers`](../../../../examples/extractors/message-handlers/README.md)
sample extractor reads it with the project's TypeScript.
`node tools/scripts/readme-images.mjs --only architecture,architecture-after`
commits `before` and `after` as two revisions and draws the images.
