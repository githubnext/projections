---
description: "This repository's command line for agents and people"
---

# tools

`tools` is this repository's command line, built for coding agents first and
people second. It reads the repository instead of restating it: package
descriptions come from README front matter, the package map from the npm
workspaces and Cargo members, the invariants from
[CONTRIBUTING.md](../../CONTRIBUTING.md#invariants), and the checks are the same
scripts `npm run check` and CI run. Output is short
[TOON](https://github.com/toon-format/toon) by default (`--json`,
`--format yaml|md` on request), problems are `{file, line, message}`, and every
result ends with `next`: the commands to run next. Exit codes: 0 success, 1 the
command found failures, 2 it couldn't run as asked, 3 a prerequisite is missing.

Run it from the workspace root:

```sh
npm run tools -- context           # start here: a one-screen briefing
npm run tools -- check --fast      # first: the cheap gates over what changed; builds and tests nothing
npm run tools -- build <workspace> # a workspace and what it needs, rebuilding only what is out of date
npm run tools -- check --affected  # the gates, for what the change touches
npm run tools -- test --affected   # the tests, likewise
npm run tools -- --help            # every command; tools <command> --help for one
```

`npx tools …` and `node tools/cli/src/bin.ts …` work too. There is no build
step: Node runs the TypeScript directly.

### `projections-tools` (optional)

`npm run tools -- link` writes a `projections-tools` command into `~/.local/bin`
(a `.cmd` shim on Windows; `--bin-dir` for elsewhere, `--dry-run` to preview) so
the same commands run from any directory:

- Inside a Projections checkout (a workspace root, or a repository that holds
  one in a subdirectory) it runs that checkout's own tools, so each worktree
  uses its own version. Anywhere else it runs the linked checkout's, and says so
  on stderr.
- It runs them with the checkout's `.node-version` Node when nvm, fnm, Volta,
  asdf, mise or n has it, else with the Node it was linked with.
- Like `npm run tools`, commands run in the workspace root, and options that
  take a directory (`--bin-dir`, `--project`) resolve from where you ran it.

It is a small launcher script, not `npm link` or a global npm install: linking
again is a no-op or relinks another checkout, and it never replaces a file it
didn't write. `npm run tools -- unlink` removes it, and `tools doctor` reports
it, including a stale link to a moved or deleted checkout. It is separate from
`install`, which builds and installs the product, because it needs no build and
has an inverse. Run as `projections-tools`, the CLI, `--llms`, skills and the
MCP server carry that name, and `projections-tools mcp add` registers the
launcher's absolute path.

## Commands

<!-- prettier-ignore -->
| Command | What it does |
| --- | --- |
| `context` | Purpose, areas, toolchains, git state, changed packages, invariants |
| `map [filter]` | Every workspace and crate with its description and dependencies |
| `explain <path>` | The owning package, nearby tests, whether it is generated, which checks apply |
| `docs search <words>`, `docs read <path or title>` | Local Markdown search and reading, by section |
| `doctor` | Toolchains, the npm registry, installed dependencies, stale builds, Playwright browsers, memory |
| `affected` | Changed workspaces and crates, their dependants, generated files to regenerate |
| `check [--affected] [--fast] [--only …]` | boundaries, casing, portability, icons, considered, lockfile, readmes, links, versions, format, cargo-fmt, build, comparators, typecheck, lint, docs (and clippy, cargo-check); `--fast` runs only the cheap ones over what changed, with `cargo check`, typecheck and lint of just the changed crates, workspaces and files |
| `build [target] [--affected] [--force] [--dry-run]` | Builds a workspace (or the changed ones) and the workspaces it depends on, rebuilding a dependency only when it is unbuilt, its src or build configuration and scripts changed, an output went missing, or its dependencies are newer, as make would; a rebuild whose outputs come out the same keeps their times, so nothing above it rebuilds |
| `test [target] [--affected] [--rust] [--browser <project>] [--filter <name>]` | Unit and Rust tests; one browser project at a time, at most 2 workers; `--filter` runs only the tests whose name matches |
| `generated [check]` | The generated files, their generators, and whether they are current |
| `ci explain [files…] [--base <ref>]` | What CI runs for a change and why: each file's class and rule, how each workspace and crate was reached, every job and suite (run or skipped) with its rules traced, and the checks with their suites, shards and filters |
| `fix` | Formatters and offline regenerators, then what changed |
| `update shadcn [components…] [--check\|--dry-run]` | Three-way merges the vendored shadcn/ui components with an upstream release (`--version`, `--unreleased`); needs the network, so `fix` never runs it |
| `install [--only cli,vscode,npm] [--project <dir>]` | Builds the checkout and installs it for early access: links `projections` into `~/.local/bin`, packages and installs the VS Code extension (`--editor code\|code-insiders\|none`), packs `@githubnext/projections` to `dist/dogfood/githubnext-projections.tgz` and points a renderer package at it; `--dry-run` prints the plan |
| `version [version] [--tag v…]` | Checks that every shipped manifest, their dependencies on each other and both lockfiles carry the release version (and the tag's), or sets them all ([releasing](../../docs/maintainers/releasing.md)) |
| `link`, `unlink` | Puts the optional `projections-tools` command on `PATH`, or removes it (below) |
| `feedback "<summary>"` | Drafts a GitHub issue about friction; files it only with `--submit` |

## Agents

`npm run tools -- --llms` prints a compact manifest of every command and
`tools <command> --schema` one command's JSON Schema. Nothing is installed into
the repository; to make `tools` a skill or an MCP server for your own agent:

```sh
npm run tools -- skills add --no-global  # skill files under .agents/skills (gitignore them), or omit --no-global for ~/.agents
npm run tools -- mcp add                 # registers `node <this checkout>/tools/src/bin.ts --mcp` with your agents (uses npx add-mcp)
npm run --silent tools -- --mcp          # or run the MCP server over stdio yourself
```

With `projections-tools` linked, `projections-tools skills add` and
`projections-tools mcp add` register it under that name instead.

## Changing it

Commands are defined in [src/cli.ts](src/cli.ts) with
[incur](https://github.com/wevm/incur): typed arguments, options and output,
which become `--help`, `--llms`, `--schema` and the MCP tools. The logic is in
`src/commands` and `src/lib`; the registry of generated files is
[src/lib/generated.ts](src/lib/generated.ts), and a file whose first line says
it is generated must be registered there. Tests:
`npm test --workspace @githubnext/projections-tools`.
