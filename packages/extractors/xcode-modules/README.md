---
description: "Xcode targets, module names, dependencies and imports (graph/v0)"
---

# Xcode modules — `graph/v0`

Reads Xcode projects (`.xcodeproj`) without Xcode: targets, their
`PRODUCT_MODULE_NAME`, target dependencies (explicit and linked), Swift package
products with `Package.resolved` versions, and the modules each target's Swift
sources import. The user guide is
[its page](../../../docs/builtins/extractors/xcode-modules.md).

## Inputs

<!-- prettier-ignore -->
| Key | Meaning |
|---|---|
| `projects` | Array of `.xcodeproj` paths. Default: every one in the revision. |
| `configuration` | The build configuration whose settings name modules. Default: each target's configuration list's default. |
| `imports` | Whether to read the Swift sources' imports. Default `true`. |

## How it reads a project

- `plist`: `project.pbxproj` is an old-style (OpenStep) property list, parsed
  into JSON values.
- `project`: every file reference's and group's project-relative path, through
  the group tree from the main group: `<group>` paths are relative to the
  enclosing group, `SOURCE_ROOT` to the project's directory; other source trees
  (`BUILT_PRODUCTS_DIR`, `SDKROOT`, absolute paths) and paths outside the
  repository aren't followed.
- `settings`: a target's settings in one configuration: defaults (`TARGET_NAME`,
  `PRODUCT_NAME = $(TARGET_NAME)`,
  `PRODUCT_MODULE_NAME = $(PRODUCT_NAME:c99extidentifier)`, `PROJECT_NAME`),
  then the project's xcconfig (with its `#include`s) and settings, then the
  target's; `$(inherited)` takes the layer below. References expand recursively;
  an unknown setting or modifier leaves the value unresolved.
- `sources`: Swift files from the Sources build phase and from synchronized
  folders (`fileSystemSynchronizedGroups`), less the
  `PBXFileSystemSynchronizedBuildFileExceptionSet` entries for the target.
- `targets`: explicit dependencies (`PBXTargetDependency`, through a container
  proxy into another project read here) and linked products (the Frameworks
  build phase, through a reference proxy for another project's).
- `packages`: `XCSwiftPackageProductDependency` and its
  `XCRemoteSwiftPackageReference` (requirement normalized as SwiftPM does) or
  `XCLocalSwiftPackageReference`.

[`swift-support`](../swift-support/README.md) reads imports and
`Package.resolved`, and builds the package entities.

## Model

<!-- prettier-ignore -->
| Entity | `id` | `kind` | `data` |
|---|---|---|---|
| Target | `xcode:<project path>:target:<name>` | `target` | `project`, `type`, `module`, `sdk`, `configuration`, `imports` |
| Package | `swiftpm:package:<identity>` | `external-package` | `source`, `location`, `requirement`, `version`/`revision`/`branch`, `transitive` |

Relationships: `depends-on` between targets (`explicit`, `linked`, `imported`,
`conditional`, `testable`), `imports` between targets when only imported, and
`depends-on` to packages (`product`, `imported`). `metadata` lists the
`projects` (`path`, `objectVersion`, `resolved`), `unresolvedModules` and
`limitations`.

## Tests

`tests/fixtures/harbor-app` is an Xcode 16 project (object version 77): an app
whose sources are a synchronized folder with an exception, a framework with
classic groups, a framework whose target name has a space and whose
configuration is based on an xcconfig, a unit test bundle, and a remote and a
local Swift package. `xcodebuild` lists, builds and reports its build settings
(Xcode 27.2); Xcode wrote its `Package.resolved`. `tests/project.rs` compares
the extraction with `harbor-app.expected.json` and asserts the module names
`xcodebuild -showBuildSettings` reports. Regenerate the golden file with
`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-xcode-modules`.

The native test, on macOS with Xcode, checks every target's module name against
`xcodebuild -showBuildSettings -json`:

```sh
PROJECTIONS_NATIVE_XCODE=1 cargo test -p projections-cli --test native_tools native_xcode
```
