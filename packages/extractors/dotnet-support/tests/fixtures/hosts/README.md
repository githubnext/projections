# Host convention fixtures

Applications without a Projections adapter, discovered the way `dotnet ef` does:

* `GenericHost`: `Program.CreateHostBuilder(string[])` with two registered contexts.
* `WebHost`: `Program.CreateWebHostBuilder(string[])` with a `Startup` class, and an
  `IDesignTimeDbContextFactory<T>` that takes precedence for EF Core.
* `MinimalHost`: top-level statements with `WebApplication.CreateBuilder`, stopped
  while building its host. Its catch-all handler must not hide the stop.

Each writes a marker file if its host ever starts; tests assert that none does.
