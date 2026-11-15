---
description: .NET service registrations and their graph (dotnet-di)
---

# .NET dependency injection — `dotnet-di`

Executed .NET service registrations and the constructor graph they compose.
Usually it needs only `inputs.project`: the application's host is found the way
`dotnet ef` finds it (`CreateHostBuilder`, `CreateWebHostBuilder` or minimal
hosting) and its complete service collection is captured while the host is
built, without starting it. This runs application startup code (in the
`Development` environment by default, where hosts can read your user secrets),
so it requires `--trust`; an explicit factory overrides the convention.
Dependency injection itself is the application's own version, read by
reflection. This extractor shares the .NET helper, configuration, application
adapter contract and validation described in
[.NET support](../dotnet-support/README.md).
