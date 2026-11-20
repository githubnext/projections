# Xcode modules

This extractor maps the module graph of an Xcode app or framework repository:
every target in each `.xcodeproj` with its module name, the targets it depends
on and links, the Swift package products it consumes (with versions pinned in
`Package.resolved`), and the modules its Swift files import. Compared across a
pull request, it shows which modules were added or removed, and which target or
package dependencies changed or upgraded.

<!-- generated: facts -->

- ID: `xcode-modules`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`dependencies`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `**/*.xcodeproj/project.pbxproj`

<!-- end generated: facts -->

## When to use it

Use this extractor in repositories with Xcode projects (`.xcodeproj`), such as
an iOS or macOS app split into frameworks, extensions, and Swift packages.
Because it parses the project files and Swift sources directly without invoking
Xcode, it needs no `--trust` and runs on Linux and Windows as well as macOS.

For a Swift package's own dependency graph (`Package.swift`), use
[`swift-package-dependencies`](swift-package-dependencies.md); for a module's
exported API surface, use [`swift-public-api`](swift-public-api.md).

## What it reads

The extractor inspects every `.xcodeproj` in the repository (or the subset
listed in `projects`) the same way Xcode does: `project.pbxproj`, any xcconfig
files referenced by build configurations, and `Package.resolved` inside the
project's workspace (`project.xcworkspace/xcshareddata/swiftpm`) or a sibling
workspace.

- **Targets.** Every native, aggregate, or legacy target becomes a `target`
  entity with its product `type` (`application`, `framework`,
  `bundle.unit-test`, …), `module`, `sdk`, and the resolved `configuration`
  (either the `configuration` input or the target's default, usually `Release`).
- **Module names.** Resolves `PRODUCT_MODULE_NAME` through Xcode's full
  precedence chain (target settings, target xcconfig, project settings, project
  xcconfig) using Xcode's defaults (`$(PRODUCT_NAME:c99extidentifier)`,
  `PRODUCT_NAME`, `$(TARGET_NAME)`), `$(inherited)`, and the `c99extidentifier`,
  `rfc1034identifier`, `lower`, and `upper` modifiers—so `Harbor Widgets`
  becomes `Harbor_Widgets`, matching `xcodebuild -showBuildSettings`. If a name
  depends on a setting not defined in the files (such as a command-line
  override), it stays `null` and is recorded in `metadata.unresolvedModules`.
  xcconfig parsing follows Xcode's rules: `//` comments anywhere on a line,
  trailing `\` line continuations, and `#include` directives.
- **Target dependencies.** Each `depends-on` edge between targets notes whether
  it is `explicit` (declared as a target dependency, including across projects),
  `linked` (implicitly linked via the target's product), and `imported`.
- **Swift packages.** Every package product a target uses becomes a `depends-on`
  edge (carrying the `product` name) to an `external-package` with its
  `location`, declared `requirement`, and the `version`, `revision`, or `branch`
  from `Package.resolved`. Pinned packages not referenced by the project are
  marked `transitive`. If multiple projects pin different versions of the same
  package, the entity records each pin under `resolved` instead of a single
  `version`. Products listed without an explicit package (like a local package
  added as a folder) are matched to the unique referenced local package that
  declares them, or otherwise reported in `metadata.unresolved`.
- **Swift imports.** Reads top-level `import` statements across each target's
  Swift files (from its Sources build phase and Xcode 16 synchronized folders,
  respecting folder exceptions). Importing another target's module marks their
  edge `imported` (plus `testable` for `@testable import`), or adds an `imports`
  edge if no declared or linked dependency exists. When multiple targets share a
  module name (such as iOS and macOS frameworks), it picks the declared or
  linked target first, then a unique match in the same project, then a unique
  global match; ambiguous imports stay unlinked. Imports inside `#if` blocks are
  tagged `conditional`, and external/system modules (`Foundation`, `SwiftUI`)
  are listed under the target's `imports`. Files containing unreadable literals
  (such as bare regexes) keep all imports parsed before that point and are
  logged in `metadata.unreadSources`. Set `imports` to `false` to skip source
  scanning and read only project files.

Target IDs combine the project path and target name
(`xcode:App%2FHarbor.xcodeproj:target:Harbor`), while external packages share
IDs with [`swift-package-dependencies`](swift-package-dependencies.md)
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

- **Targets** added or removed, plus changes to a target's `module`, `type`, or
  imported system modules.
- **Target dependencies** added, removed, or shifting between declared, linked,
  and import-only edges.
- **Packages** added, removed, upgraded, or downgraded, labeled and tallied by
  which version component moved.

Your targets sit on the left as the graph's roots.

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

- Because it parses project files without running Xcode, it doesn't see
  command-line build settings, scheme overrides, CocoaPods or Carthage build
  phases, or conditional settings like `PRODUCT_NAME[sdk=iphoneos*]`.
- Swift imports are scanned statically from source text: imports inside `#if`
  count regardless of branch, `canImport(…)` isn't evaluated, macros aren't
  expanded, and Objective-C `#import` and `@import` directives aren't parsed.
- Workspaces (`.xcworkspace`) aren't evaluated directly; projects are discovered
  across the repository, and dependencies on targets in projects outside the
  repository aren't followed.
- Local Swift packages appear as packages without expanding their internal
  targets—use [`swift-package-dependencies`](swift-package-dependencies.md) to
  inspect inside them.

## Related

- [`graph`](../renderers/graph.md) — draws this graph using its `dependencies`
  presentation.
- [`swift-package-dependencies`](swift-package-dependencies.md) — the dependency
  graph for Swift packages.
- [`swift-public-api`](swift-public-api.md) — inspect what a module exports.

## How it works

See the [package README](../../../packages/extractors/xcode-modules/README.md)
for details on project, build-setting, and source parsing.

## Build your own

Consider writing a custom extractor if static Xcode project files aren't the
graph you need:

- **Live build-system output**, using `xcodebuild -showBuildSettings -json` or
  build logs for a specific scheme and destination (which requires macOS and
  Xcode).
- **Other iOS/macOS build tools**, reading Tuist, XcodeGen, Bazel, or Buck
  manifests directly.
- **Extra metadata**, such as team ownership, binary sizes, or app launch costs.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick a language. You can also choose **Ask an agent to write it** and describe
what you want to see.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer dependencies
```

Test changes as you go with `projections show -p <id> --trust`.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example.
