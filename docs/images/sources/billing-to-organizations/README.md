---
description: "A Prisma schema before and after billing moves from users to organizations, for the gallery's database images"
---

# Billing moves to organizations

The [gallery](../../../../docs/gallery.md#database-schema)'s database images.

`before` keeps the plan and Stripe customer on `User`; `after` moves them to a
new `Organization` that users join through `Membership`, with a `Role` enum, and
points projects and invoices at the organization. The
[`prisma-schema`](../../../../docs/builtins/extractors/prisma-schema.md)
extractor reads `schema.prisma`; nothing runs.
`node tools/scripts/readme-images.mjs --only database,database-after` commits
`before` and `after` as two revisions and draws the images.
