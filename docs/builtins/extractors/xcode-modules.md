# Xcode modules

The modules of an Xcode app or framework project: each target of every
`.xcodeproj` with its module name, the targets it depends on and links, the
Swift package products it uses with the versions `Package.resolved` pins, and
the modules its Swift sources import. Compared across a pull request, it answers
"which modules did this change add or remove, and which dependencies between
them, or on packages, did it add, remove or upgrade?"

<!-- generated: facts -->

- ID: `xcode-modules`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `**/*.xcodeproj/project.pbxproj`

<!-- end generated: facts -->

## When to use it

Use it in a repository with Xcode projects (`.xcodeproj`), such as an iOS or
macOS app split into frameworks, extensions and Swift packages. It reads the
project files and sources without Xcode, so it needs no `--trust` and runs on
Linux and Windows too.

For a Swift package's own graph (`Package.swift`) use
[`swift-package-dependencies`](swift-package-dependencies.md).

## What it reads

It reads every `.xcodeproj` in the repository (or those `projects` names) as
Xcode does: `project.pbxproj`, the xcconfig files its build configurations are
based on, and `Package.resolved` from the project's workspace
(`project.xcworkspace/xcshareddata/swiftpm`) or a workspace beside it.

- **Targets**: each native, aggregate or legacy target is a `target` entity with
  its product `type` (`application`, `framework`, `bundle.unit-test`, …), its
  `module` and `sdk`, and the `configuration` they come from: the one
  `configuration` names, else the target's default (usually `Release`).
- **Module names**: `PRODUCT_MODULE_NAME`, from the target's settings over its
  xcconfig over the project's settings and xcconfig, with Xcode's defaults
  (`$(PRODUCT_NAME:c99extidentifier)`, `PRODUCT_NAME` `$(TARGET_NAME)`),
  `$(inherited)`, and the `c99extidentifier`, `rfc1034identifier`, `lower` and
  `upper` modifiers, so `Harbor Widgets` is `Harbor_Widgets`, as
  `xcodebuild -showBuildSettings` reports. A module name that uses a setting the
  files don't define (one set on the command line or by the build system) is
  `null` and listed in `metadata.unresolvedModules`. xcconfig files are read as
  Xcode reads them: `//` starts a comment anywhere on a line, a trailing `\`
  continues a line, and `#include` follows.
- **Dependencies**: a target's `depends-on` another records whether it is
  `explicit` (a target dependency, including one in another project read here),
  `linked` (it links the other target's product: Xcode's implicit dependency)
  and `imported`.
- **Packages**: each package product a target uses is a `depends-on`
  relationship, naming the `product`, to an `external-package` with its
  `location`, the project's `requirement` and the `version`, `revision` or
  `branch` `Package.resolved` pins; packages it pins that the project doesn't
  reference are `transitive`. When projects pin one package differently, it has
  each project's pin, as `resolved`, instead of one `version`. A product listed
  without its package (a local package added as a folder) belongs to the one
  local package the project refers to that declares it; otherwise it's listed in
  `metadata.unresolved`.
- **Imports**: the top-level `import` declarations of each target's Swift files,
  those its Sources build phase lists and those in the folders it synchronizes
  (Xcode 16), less the folders' exceptions for it. An import of another target's
  module marks their relationship `imported` (and `testable` for
  `@testable import`); one with no declared or linked dependency is an `imports`
  relationship. When several targets have the module's name (an iOS and a macOS
  framework), the one the target declares or links is meant; with neither, the
  only one in its project or, failing that, the only one; otherwise the import
  names no target. An import only inside `#if` is `conditional`. Other modules
  (`Foundation`, `SwiftUI`) are listed in the target's `imports`. A source with
  a literal the reader can't read (a bare regex) gives the imports before it,
  and is listed in `metadata.unreadSources`. Set `imports` to `false` to read
  only the project files.

IDs are the project's path and the target's name
(`xcode:App%2FHarbor.xcodeproj:target:Harbor`); packages share
[`swift-package-dependencies`](swift-package-dependencies.md)'s IDs
(`swiftpm:package:swift-collections`).

## Options

<!-- generated: inputs -->

| Input           | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `configuration` | Build configuration whose settings name modules; default each target's default configuration. |
| `imports`       | Read the modules each target's Swift files import; default true.                              |
| `projects`      | Array of .xcodeproj paths; default every one in the repository.                               |

<!-- end generated: inputs -->

## What a comparison shows

- **Targets** added or removed, and changes to a target's `module`, `type` or
  imported system modules.
- **Dependencies** between targets added, removed, or changed between declared,
  linked and only imported.
- **Packages** added or removed, and upgrades and downgrades, worded and counted
  by the part of the version that moved.

Targets are the graph's roots.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "xcode-modules",
  "id": "xcode-modules",
  "renderer": "dependencies",
  "title": "Xcode modules"
}
```

<!-- end generated: definition -->

## Limitations

- It reads the files Xcode reads, but doesn't run Xcode: settings passed on the
  command line, by schemes or by CocoaPods' and Carthage's build phases aren't
  seen. Conditional settings (`PRODUCT_NAME[sdk=iphoneos*]`) are left out.
- Imports come from the sources' text. Imports inside `#if` count whichever
  branch they're in, and `canImport(…)` isn't evaluated; macros aren't expanded.
  Objective-C `#import` and `@import` aren't read.
- Workspaces (`.xcworkspace`) aren't read as such: projects are read wherever
  they are, and a dependency on a target in a project the workspace adds from
  outside the repository isn't followed.
- Local Swift packages are packages here, without their targets; read them with
  [`swift-package-dependencies`](swift-package-dependencies.md).

## Related

- [`graph`](../renderers/graph.md), whose `dependencies` presentation draws it.
- [`swift-package-dependencies`](swift-package-dependencies.md), for Swift
  packages.

## How it works

The [package README](../../../packages/extractors/xcode-modules/README.md)
details how projects, settings and sources are read.

## Build your own

Write your own extractor when the project files aren't the graph you need:

- **The build's own graph**: what `xcodebuild -showBuildSettings -json` or the
  build log reports for a scheme and destination, which needs Xcode and macOS.
- **Other build systems**: Tuist, XcodeGen, Bazel or Buck targets, from their
  own manifests.
- **Facts Xcode doesn't have**: owners, binary sizes or launch costs.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick its language. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

Run it with `projections show -p <id> --trust` as you change it.
[Write your first extractor](../../guides/first-extractor.md) walks through one.
