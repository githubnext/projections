---
description: "The small ASP.NET Core-style app behind the README's dependency injection images, before and after a change"
---

# OrderService split

The README's dependency injection images (the hero) and the
[gallery](../../../../docs/gallery.md#dependency-injection)'s.

A shop application's service registrations at two revisions: `before`, where one
`OrderService` does checkout and lookups, and `after`, where it is split into
`CheckoutService`, which charges and saves orders, and `OrderQueries`, which
searches them. `node tools/scripts/readme-images.mjs --only di-split` commits
the two folders as two revisions in a scratch repository and draws the README's
images from them with the
[`dotnet-di`](../../../../docs/builtins/extractors/dotnet-di.md) extractor,
which builds the project (the .NET 8 SDK) and reads `Composition.Services()`,
the application's own registrations.
