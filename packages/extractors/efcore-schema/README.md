---
description: "A DbContext's EF Core model as a schema (efcore-schema)"
---

# EF Core schema — `efcore-schema`

Effective EF Core model. Usually it needs only `inputs.project` (and
`inputs.context` when there are several contexts): the `DbContext` is found the
way `dotnet ef` finds it, from an `IDesignTimeDbContextFactory<T>` first, else
from the application's built but never started host, else from a parameterless
constructor. This runs application startup code (in the `Development`
environment by default, where hosts can read your user secrets), so it requires
`--trust`; an explicit factory overrides the convention. EF Core itself is the
application's own version, read by reflection. This extractor shares the .NET
helper, configuration, application adapter contract and validation described in
[.NET support](../dotnet-support/README.md).
