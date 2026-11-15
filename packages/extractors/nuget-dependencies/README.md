---
description: The resolved NuGet package graph (graph/v0)
---

# NuGet dependencies — `graph/v0`

The resolved package graph, direct and transitive, presented by the graph
renderer's
[`dependencies` view](../../renderers/graph/README.md#dependency-graphs).

- `assetsPaths`: array of `project.assets.json` paths in the revision, read
  without trust. Git-ignored files aren't part of a revision, and one a checkout
  has on disk but Git ignores fails, naming it.
- If omitted, the extractor requires trust and restores each revision:
  `dotnet restore <project> -p:RestoreRecursive=false -p:MSBuildProjectExtensionsPath=<private folder>/`
  for every `.csproj`, `.fsproj` and `.vbproj` of the revision (or the
  `projects` array), with `dotnet` (default `dotnet`) and the repository's NuGet
  configuration. Each restore writes only its own project's assets, outside the
  checkout; the environment and packages folder follow the
  [.NET support](../dotnet-support/README.md) rules.

Consumes NuGet assets schema versions 3 and 4. Project entities use
`project.restore.projectName`; names must be unique across supplied assets. Each
target framework / runtime identifier has its own resolved package and
project-reference entities, identified by project, target and lowercase package
ID (NuGet IDs are case-insensitive). The resolved version is package data, not
part of the ID, so a version bump is one modified package. Edges preserve target
membership, direct package dependencies and transitive dependencies using the
resolved versions in `targets`, not version-range guesses. Restore paths, cache
directories and absolute project paths are excluded. Imported assets must come
from a successful, up-to-date restore.

NuGet v4 (SDK 10.0.300+) uses framework **aliases** as target/project-framework
keys and adds each framework's normalized `framework` name. Aliases and RID
variants remain separate graph identities even when they normalize to the same
framework; target entities retain the normalized name in `data.framework`.
Package identities and resolved dependency records retain the v3 layout.
Compatibility was checked against NuGet.Client's
[v4 aliasing change](https://github.com/NuGet/NuGet.Client/commit/fbcb61756ab3090b13f2909ebc5fe2177b356c82)
(`LockFileBuilder`, `LockFileFormat`, and `PackageSpecWriter`) and is covered by
an alias/RID regression fixture. V4 inputs missing the normalized framework
field, and unknown versions such as v5, are rejected. The native test uses the
selected SDK without pinning SDK 8, so CI can exercise either supported format.

Shared input, path and trust rules for native ecosystem extractors are in
[the extractors overview](../README.md#ecosystem-extractors).
