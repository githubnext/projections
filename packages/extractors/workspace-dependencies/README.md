---
description: "A Node workspace's packages and dependencies (graph/v0)"
---

# Workspace dependencies — `graph/v0`

Reads a Node workspace the way its package manager does: which packages are
workspaces, what each declares, what the lockfile resolved each declaration to,
and what those packages depend on in turn, transitively. The result is the
dependency graph the `dependencies` renderer (part of the graph renderer)
presents: what pulls in what, and how a change reshapes it. It supports npm and
Yarn `workspaces` and pnpm's `pnpm-workspace.yaml`, and reads
`package-lock.json` (or `npm-shrinkwrap.json`), `pnpm-lock.yaml` and `yarn.lock`
from Yarn classic and Yarn Berry.

Reading manifests and lockfiles executes nothing and does not require `--trust`.
This is one of the two default projections the CLI uses when a revision has no
authored definitions; it is only applied to revisions with a root
`package.json`.

## Inputs

<!-- prettier-ignore -->
| Key | Meaning |
|---|---|
| `root` | Repository-relative workspace root. Default `"."`. Manifests, the workspace file and the lockfile are read relative to it. |
| `packageManager` | `npm`, `pnpm` or `yarn`, overriding detection. |

The root `package.json` is required: a revision without one fails rather than
producing an empty graph.

## Package manager

The package manager decides how workspaces are selected and which lockfile is
read. It is, in order: `inputs.packageManager`; the root manifest's
[`packageManager`](https://nodejs.org/api/packages.html#packagemanager) field;
the one kind of lockfile present; pnpm when only `pnpm-workspace.yaml` exists;
otherwise npm. Lockfiles from several managers without either setting are an
error. Yarn classic and Berry are told apart by the lockfile (Berry's has
`__metadata`) or, without one, by the `packageManager` version.

| Manager            | Workspaces                       | Lockfile                                                                      |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| npm                | `package.json` `workspaces`      | `package-lock.json` / `npm-shrinkwrap.json`, lockfile version 2 or 3 (npm 7+) |
| pnpm               | `pnpm-workspace.yaml` `packages` | `pnpm-lock.yaml`, lockfile versions 5 to 9                                    |
| Yarn classic (1.x) | `package.json` `workspaces`      | `yarn.lock` v1                                                                |
| Yarn Berry (2+)    | `package.json` `workspaces`      | `yarn.lock` (YAML, `__metadata`)                                              |

Workspace patterns select directories containing a `package.json`, never inside
`node_modules`. They support `*`, `**`, `?` and `{a,b}` alternatives; `!pattern`
excludes directories, except under **Yarn classic, which ignores negated
patterns** (as `yarn workspaces info` shows), so the extractor keeps those
packages and records the ignored patterns in `metadata.ignoredPatterns`.
Character classes and extended globs are rejected rather than approximated.

Lockfiles are parsed, not resolved by running the package manager: its read-only
commands either need an installed `node_modules` (`yarn list`, `pnpm list`), may
download the package manager itself, or would make this default projection
require `--trust`. Each lockfile is read with the manager's own resolution
rules:

- **npm:** a dependency declared by the package in `dir` resolves to the nearest
  `dir/node_modules/<name>` entry, walking up to `node_modules/<name>`; `link`
  entries are workspace links.
- **pnpm:** the importer for the package's directory records each dependency's
  version, without the peer suffix (`1.2.3(react@18.2.0)`); `link:` versions are
  workspace links; alias versions name the real package (`is-number@6.0.0`).
  `catalog:` specifiers resolve the same way, since the importer records the
  version the catalog entry resolved to. pnpm 11 and later may write a boot
  document (config dependencies and the pnpm version) before the project
  lockfile; only the last YAML document, the project's own graph, is read.
- **Yarn classic:** the `name@range` descriptor's entry; a workspace dependency
  without one is linked to the workspace.
- **Yarn Berry:** the `name@range` descriptor, with `npm:` added to ranges that
  have no protocol, as Berry does; `@workspace:` resolutions are workspace
  links.

Installed packages' own dependencies are read from the same lockfile:

- **npm:** each `node_modules/…` entry's `dependencies` and
  `optionalDependencies`, resolved from where the package is installed, walking
  up nested `node_modules` as Node does.
- **pnpm:** `snapshots` (lockfile 9) or `packages` (5 to 8) `dependencies` and
  `optionalDependencies`. pnpm records what each resolved to, not the requested
  range, so these relationships have no `version`.
- **Yarn classic and Berry:** each entry's `dependencies` and
  `optionalDependencies` (Berry marks optional ones in `dependenciesMeta`)
  resolved through their descriptors.

A package installed in several places (npm nesting, pnpm peer variants) is one
package per name and version; its dependencies come from the first place it is
installed, in lockfile order. Only packages a workspace reaches are included.

A declaration the lockfile doesn't record (a stale lockfile, or an optional
dependency for another platform) has no `resolved` value and is listed in
`metadata.unresolved`, as is a missing non-optional transitive dependency
(`[<package ID>, kind, key]`); peer dependencies are not listed, because not
every manager locks them, and neither are optional dependencies a platform
skipped. A malformed or unsupported lockfile is an error.

## Model

<!-- prettier-ignore -->
| Entity | `id` | `kind` | `data` |
|---|---|---|---|
| Workspace package | `workspace:<name>` | `package` | `workspaceMember: true`, `path`, `version` from its manifest |
| Unnamed workspace root | `workspace-root` | `package` | as above |
| Installed package | `package:<name>`, or `package:<name>@<line>` when several versions are installed at once | `external-package` | `version`: the installed version |
| Unresolved package | `package:<name>` | `external-package` | none: no lockfile, or the lockfile doesn't record it |

Each declaration in `dependencies`, `devDependencies`, `peerDependencies` or
`optionalDependencies` is a relationship of that kind from the declaring package
to the installed package, with ID
`dependency:["<declaring name>","<kind>","<key>"]` (the root's declaring name is
`.` when it has none), labeled with the declared range. Each installed package's
own `dependencies` and `optionalDependencies` are relationships of that kind
from it, with ID `dependency:["<package ID>","<kind>","<key>"]`, labeled with
the locked range (none for pnpm), and the lockfile as evidence. They carry no
`resolved` value: the installed package's version is its own data, so a
transitive relationship changes only when the requested range does.

<!-- prettier-ignore -->
| `data` field | Meaning |
|---|---|
| `type` | The dependency kind. |
| `version` | The declared range, exactly as written (`^1.2.0`, `workspace:^`, `npm:is-number@^6.0.0`); absent for pnpm's transitive relationships. |
| `resolved` | The locked version, or the linked workspace package's version (declarations only). |
| `alias` | The installed name, when an `npm:` alias installs a package under another name. |

Identities never contain versions, so an upgrade changes data rather than
identity and compares as a modification. When a name is installed at several
versions at once (`is-number` 3, 6 and 7), each ID adds the semver-compatible
line the versions unify within (`@3`, `@6`, `@0.4`, `@0.0.3`), or the full
version if two share a line, as `cargo-dependencies` does; an upgrade within a
line is still one modified package. An `npm:` alias points at the real package
(`"number-check": "npm:is-number@^6"` targets `package:is-number`). A
`workspace:` dependency must name a workspace package. Workspace packages must
be named, and names must be unique; the root may be unnamed.

`metadata` records the `packageManager`, the `lockfile` path and its
`lockfileVersion`. Entities and relationships are sorted by ID, so the same
revision always produces the same extraction.

## Tests

`tests/fixtures/{npm,pnpm,yarn-classic,yarn-berry}` hold one workspace — a
negated pattern, a `**` pattern, an `npm:` alias, `workspace:` links (pnpm and
Berry), and every dependency kind — with the lockfile written by npm 11, pnpm
11, Yarn 1.22 and Yarn 4.9. `tests/managers.rs` compares each with its golden
`<manager>.expected.json` and checks that every manager reports the same graph,
apart from the documented Yarn differences. It also prepends a pnpm 11 boot
document to the pnpm lockfile, and `tests/fixtures/pnpm-catalog` holds a
synthetic two-document pnpm 12 lockfile with `catalog:` specifiers and registry
revisions. Regenerate the golden files with
`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-workspace-dependencies`.
