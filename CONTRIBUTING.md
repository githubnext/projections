# Contributing

Thanks for helping improve Projections. Please follow the
[code of conduct](CODE_OF_CONDUCT.md). Imports, fixtures and scripts must work
from a fresh clone of this repository, without private repositories,
machine-specific paths or credentials.

## Layout

Everything that ships, or that something shipped depends on, is in `packages/`:
the CLI, Engine, schemas, comparators, extractors, renderers, the host
(`packages/host/core`, its VS Code UI `packages/host/vscode-ui` and the
Inspector `packages/host/inspector`), `@githubnext/projections`
(`packages/sdk`), the VS Code extension, the GitHub Action's scripts and the
agent integrations. Repository infrastructure stays outside it: the repository's
command line (`tools/cli`), build, check and release scripts (`tools/scripts`),
Storybook (`tools/storybook`), the source-checkout `gh` extension launcher
(`tools/gh-projections`) and the workflows. A new package goes in `packages/` if
it ships or something shipped needs it, and in `tools/` otherwise. Shipped code
never imports `tools/` at run time; builds and tests may use its scripts and
Storybook. `action.yml` stays at the root, where
`uses: githubnext/projections@v0` and the Marketplace find it.
[Repository layout](#repository-layout) lists every directory.

## Development

Use the Node version in `.node-version` (26.12.1 or later), npm and Rustup. The
checked-in Rust toolchain selects the compiler and Wasm target; no private SDK
or credentials are needed. Node is build tooling for the browser UI and
packages: the CLI itself is a self-contained native executable that never needs
it.

```sh
npm ci
npm run check
npm run test:rust
npm run test:browser
npm run test:installed
npm run test:binary
npm run test:packed
```

The repository's own command line, [`tools`](tools/cli/README.md), wraps these
for agents and people: `npm run tools -- context` is a one-screen briefing, and
`npm run tools -- check --affected` and `npm run tools -- test --affected` run
the gates and tests for what a change touches (`npm run tools -- --help` lists
the rest). `npm run tools -- check --fast` runs only the cheap gates over what
changed, and `npm run tools -- build <workspace>` builds one workspace and
whatever it depends on that is out of date, where `npm run build` rebuilds
everything. Report friction with it, or with these docs, with
`npm run tools -- feedback "<summary>"`, which drafts an issue. GitHub Copilot
cloud agent starts from
[`copilot-setup-steps.yml`](.github/workflows/copilot-setup-steps.yml), which
installs the pinned toolchains and dependencies, builds the workspace and
installs Chromium before the agent's first step. `npm run tools -- install`
builds your checkout and installs it as you would use it: the CLI on `PATH`, the
VS Code extension and the packed npm package (see
[Early access (from source)](docs/setup/early-access.md)). Optionally,
`npm run tools -- link` puts a `projections-tools` command on `PATH` that runs
these tools from any directory, in whichever checkout or worktree you are in;
`npm run tools --` stays the documented way to run them.

The browser suites (`npm run test:browser`) use Playwright's Chromium and
WebKit, which `npm ci` doesn't download. Install them once, and again after
Playwright updates (`--with-deps` also installs their system libraries on
Linux):

```sh
npm exec -- playwright install --with-deps chromium webkit
```

npm 11 warns after installing that esbuild's `postinstall` script (and, on
macOS, fsevents' install script) is not covered by `allowScripts`
(`npm install-scripts ls` lists them). Nothing here needs them: esbuild finds
its platform binary, installed as an optional dependency, at run time, and the
script only verifies that binary and speeds up its startup; fsevents ships
prebuilt. Builds and tests pass without them. Leave them unapproved; this
repository configures no `allowScripts`.

Formatting is [oxfmt](https://oxc.rs/docs/guide/usage/formatter)
(`.oxfmtrc.json`); run `npm run format` before committing. `npm run check` runs
`format:check`, and ESLint remains the only linter.

Lockfiles always record `registry.npmjs.org` tarball URLs even though installs
go through the committed `.npmrc` (see [Package sources](#package-sources)): npm
maps those URLs to the configured registry when it fetches. If an install
records the mirror's URLs instead, run
`node tools/scripts/lockfile-registry.mjs --fix` after changing dependencies;
`npm run check` fails on any other host. `npm run check` includes dependency
boundaries, [file standards](docs/maintainers/file-standards.md) (file size,
line length and complexity, with Considered;
`node tools/scripts/considered.mjs install` installs it), builds (including the
Storybook), unfiltered TypeScript, lint and Node tests; Rust and browser checks
are separate. `npm run storybook` serves the host UIs' Storybook on port 6006
while you work on `packages/host/core/` or `packages/host/vscode-ui/`; add a
story beside the existing ones for each new prebuilt view or building block (see
[the Storybook README](tools/storybook/README.md)). Optional native extractor
tests require their documented toolchains. Missing tools must fail when their
tests are explicitly enabled, not become passing empty results. See
[runner coverage](docs/maintainers/runner-coverage.md) for native and container
commands. Changes to the Engine or the default comparator also keep their
coverage and mutation testing bars; see
[testing the Engine](packages/engine/TESTING.md).

With GitHub CLI installed, `npm run test:gh` extends `test:installed` with an
isolated local extension installation and actual CLI execution. It does not
register an extension globally or use your GitHub credentials. Public CI selects
that superset; ordinary CLI use does not require `gh`. `npm run test:binary`
proves `packages/cli/dist/projections` moved into an empty directory without
Node on PATH; pass `-- --binary FILE` to prove a release asset.

Run the smallest checks covering a change first, then the relevant integration
checks: `tools check --fast` (format, lint, `cargo check` and typecheck of what
changed), then `tools build <workspace>` if a test needs built output, then the
narrowest tests (`tools test <target> --filter <name>`), and only then
`tools check --affected`, `tools test --affected` and the full `npm run check`.
A compile error found by a test run or a full build costs minutes, and on a
shared machine a wait for a slot, that `--fast` spends seconds on. Preserve
strict error, cancellation, geometry, progress and input validation assertions.
A failure is evidence to diagnose, not a reason to increase a deadline, drop a
frame, substitute a fixture for an enabled native test or silently return an
empty model.

### Faster local builds (optional)

Each checkout and worktree compiles every Rust dependency into its own
`target/`. A shared compile cache such as
[sccache](https://github.com/mozilla/sccache) lets a new worktree reuse the
dependencies another one already compiled. It is a machine setting, not a
repository one, so nothing here requires it:

```toml
# ~/.cargo/config.toml
[build]
rustc-wrapper = "/path/to/sccache"
```

Set its size in sccache's own configuration (`[cache.disk] size`; 10 GiB by
default). `client_side_mode = true` there runs each compile in a child of Cargo,
so memory is counted against the build that caused it. sccache caches dependency
crates, not the workspace's own crates, which build incrementally, nor crates
whose inputs name the checkout's path: those that read `OUT_DIR` (`serde`,
`thiserror`) and everything above them, and procedural macros.
`sccache --show-stats` shows what it hit.

`npm ci` replaces `node_modules` from npm's cache; it is bound by the file
system, not the registry. Run it only in a fresh checkout or after the lockfile
changes (`npm run tools -- doctor` says when).

### Continuous integration

Checks include independent import/dependency boundaries, TypeScript, the
existing correctness-focused ESLint rules, actual native-engine artifact tests,
and explicit Rust/browser commands. Generated output is not linted as authored
code. CI uses the same public composite action on Linux and macOS; local macOS
results do not imply those remote matrix jobs have passed. The browser suites
run on Linux in their own jobs, the large ones sharded. Linux also enables all
optional native extractor suites and the real Docker policy/digest-parity check
described in [runner coverage](docs/maintainers/runner-coverage.md). Windows has
three jobs: `windows` runs the Rust suites natively, including Job Object
supervision of extractor process trees; `windows-node` runs every Node suite,
the installed-package proof and the checks that read the file system; and
`windows-integration` runs the CLI's browser suite, a renderer smoke test, the
VS Code extension in VS Code and the GitHub Action end to end. macOS also runs
the renderers in WebKit. Tests that can't run on a platform are skipped or
ignored there with their reason. The release workflow runs `npm run test:binary`
on every platform. Which suite runs where is in
[platform coverage](docs/maintainers/runner-coverage.md#platform-coverage).

Shipped code must not assume an operating system: `npm run check:portability`
fails on POSIX shells and paths, command strings run through a shell, launchers
named as only one platform names them (`npm` without its `.cmd` shim,
`python3`), native paths handled as POSIX ones and file text split as if it had
no CRLF. An intended exception goes in `.portability.yaml` with its reason.

#### What CI runs

A pull request runs only the jobs its change reaches. The Projections workflow's
first job, `changes`, runs `tools/scripts/ci-plan.mjs`
(`tools/cli/src/lib/ci-plan.ts`), which maps the changed files to their
workspaces and crates and everything depending on them, with the same graph as
`npm run tools -- affected`, plus what no manifest declares: the files crates
read by path (`include_str!`, `CARGO_MANIFEST_DIR`), the crates and packages a
workspace's `build` script compiles or builds (`cargo build -p`), the
extractions and comparators renderers' `scenarios.json` files name, and the
renderers under the harness's `testDir`. A file only a crate's tests read runs
that crate's suites without changing its dependants. Its summary lists each job
and why it runs.

| Change                                                                                                                                                     | Runs                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation alone (Markdown, `docs/`) that no generator or crate reads, outside fixtures, tests and templates                                            | `docs`: format, lint, file standards, boundaries, casing, READMEs and links, with no build                                                                                         |
| Anything else                                                                                                                                              | `public-product` on Linux: the full check, Node and Rust suites, generated documentation and the self-projection                                                                   |
| Code that doesn't only run in a browser (not `packages/renderers`, `packages/host`, `tools/storybook` or `examples/renderers` alone), Rust or `action.yml` | `public-product` on macOS, `windows-node` and `windows-integration`                                                                                                                |
| Rust (`.rs`, `Cargo.toml`) or any other file of a crate                                                                                                    | `windows` (the Rust suites)                                                                                                                                                        |
| The Engine's crates                                                                                                                                        | `verus`                                                                                                                                                                            |
| What the Engine's coverage measures (`test:rust:coverage`)                                                                                                 | `coverage`                                                                                                                                                                         |
| A file `.cargo/mutants.toml` examines                                                                                                                      | `mutants-diff`                                                                                                                                                                     |
| A browser suite, what it depends on or builds, or (for suites that run the CLI's backend) the CLI and what it depends on but the extractors                | That suite in `browser`, the large ones sharded; the rest together in `browser (rest)`                                                                                             |
| Renderers alone (not the kit, SDK or harness they share)                                                                                                   | The renderer harness, in `browser` and `browser-macos`, without the other renderers' specs and the tests titled for them alone (`--grep-invert`): a job a project for one renderer |
| The SDK, the CLI or Rust                                                                                                                                   | `package`                                                                                                                                                                          |
| `dist-workspace.toml`, `.github/release-build-setup.yml` or a `Cargo.toml`                                                                                 | `release-config`, which also plans the release (pull requests don't run `release.yml`)                                                                                             |

Everything runs on pushes to `main`, nightly, on a manual run (**Run workflow**
on the Projections workflow) and for any change to `.github/workflows/`,
`.github/actions/`, `package.json`, `package-lock.json`, `Cargo.toml`,
`Cargo.lock`, `rust-toolchain.toml`, `.node-version`, `.npmrc`, `.cargo/`,
`tools/cli/` or `tools/scripts/`, or to a file outside every workspace and crate
that the plan doesn't recognise. To run everything on a pull request, add the
`ci:full` label, then push or re-run the workflow: the plan reads the labels
when it runs.

`ci-ok` is the one required check. It passes when `changes` succeeded and every
other job passed or was left out by the plan; a failed, cancelled or timed-out
job fails it. See what a branch would run with `node tools/scripts/ci-plan.mjs`
(since `origin/main`, uncommitted changes included).

## Repository layout

The repository is organized by domain component; language only determines what
is inside each directory. Everything that ships, or that something shipped
depends on, is in `packages/`; the repository's own tooling is in `tools/`:

```
packages/
  schemas/       language-neutral contracts (JSON Schema, TypeScript types) and the conformance corpus
  engine/        Rust Engine (native + Wasm); engine/js is its TypeScript transport and verified artifact loading
  comparators/   the default comparator, the comparator rules interpreter and its sandboxed runtime, and the API compatibility and runtime policy rules
  extractors/    one Rust crate per built-in extractor, with shared support, the catalog and helpers
  renderers/     one package per built-in renderer (sandboxed frame bundles) and renderers/sdk for authors
  sdk/           @githubnext/projections, the one package renderer and extractor authors install
  host/core/     the browser host: renderer frames, playback, selection, in-browser comparison, table and text views
  host/vscode-ui/  the host's optional VS Code UI (VSCode Elements, codicons, VS Code's theme variables)
  host/inspector/  the Inspector UI, a mountable package (its assets are embedded in the CLI)
  cli/           the native Rust CLI, runner and Inspector backend (serve --stdio)
  integrations/  Projections inside another product, one folder per host product (see its README)
    vscode/          the VS Code extension: the Inspector, Explore, Adopt and Add to CI beside your code
    github-action/   scripts of the GitHub Action (action.yml) that produces projections artifacts in CI
    copilot-canvas/  the Projections viewer as a canvas in the GitHub Copilot app
tools/
  cli/           `tools`, this repository's command line for agents and people
  scripts/       build, check, release and documentation scripts
  storybook/     Storybook for the host's default UI and the VS Code UI, on the renderers' scenarios
  gh-projections/  the launcher that installs a source checkout as a gh extension
examples/  docs/  brand/  notices/
```

The CLI and the Inspector backend are native Rust, using Clap and the shared
Engine directly; the VS Code extension runs the CLI's backend
(`projections serve --stdio`). Alongside them are the default comparator (native
and as a zero-import Wasm module), the comparator rules interpreter, the
polyglot extractor runner, the built-in extractor sources, custom extractor
samples, a browser host with sandboxed renderer frames and shared verified
artifact loading. Capability acceptance is separate from source availability.
Public components must not import files outside this repository.

## Invariants

These hold for every change; `npm run tools -- context` prints them.

- One Rust semantic implementation, the Engine, serves native and Wasm hosts;
  never add a JavaScript semantic fallback.
- Collection, acquisition, semantic processing (validation, matching, hashing)
  and presentation stay separate.
- Extractor toolchains are optional. Anything that displays CI artifacts
  consumes them and never runs repository extractors.
- Browser-safe packages (schemas, renderers, host, host-vscode) import no Node
  execution, authentication, extractors or host-specific UI dependencies, and
  nothing depends on a design system (`npm run check:boundaries`).
- Workspaces depend downward only: schemas, Engine, renderer SDK, kit, built-in
  renderers, hosts, Inspector, then the VS Code extension and CLI. A workspace
  imports only first-party packages it declares, and never another workspace's
  files by path from its shipped `src/` (the layer table in
  `tools/scripts/check-boundaries/layers.mjs`).
- First-party extractors, comparators and renderers use only the public SDKs
  third parties use.
- Generated files are never edited by hand: change their sources and regenerate
  (`npm run tools -- generated`).
- JSON Schemas change only additively within a major version.
- Packages install through the committed `.npmrc` registry, never the public npm
  registry directly.
- A failing check is evidence to diagnose, not a reason to loosen a deadline,
  drop an assertion or substitute a fixture.
- Fixtures are synthetic and reproducible: no credentials, private source or
  machine state.

## Package sources

npm, PyPI and NuGet packages come through Microsoft's public package feed proxy,
for every contributor and every CI run. It mirrors the public registries, so
installs get the same packages, but our CI machines' security requirements allow
installs only through it, and installing the same way everywhere keeps local
results and CI's identical. It is anonymous: no account, token or setup. The
committed configuration below selects it, and installs never fall back to
registry.npmjs.org or nuget.org directly. Tests that install outside the
workspace (scratch projects, packed-package proofs) pass the workspace's
registry on.

<!-- prettier-ignore -->
| Ecosystem | Feed | Configured in |
| --- | --- | --- |
| npm | `https://packagefeedproxy.microsoft.io/npm/` | `.npmrc`; CI also sets `npm_config_registry` for installs outside the workspace |
| PyPI | `https://packagefeedproxy.microsoft.io/pypi/simple/` | `PIP_INDEX_URL` in CI (the Django helper's requirements) |
| NuGet | `https://packagefeedproxy.microsoft.io/nuget/v3/index.json` | `nuget.config`, and the `--source` of the native suites' own restores |
| Maven | Maven Central and the Gradle Plugin Portal | The Spring fixture's `pom.xml`, `build.gradle` and `settings.gradle` (the defaults) |

pip has no committed configuration; to run the native Django suite locally, set
`PIP_INDEX_URL` as CI does. Maven uses Maven Central for now: the proxy's Maven
endpoint, `https://packagefeedproxy.microsoft.io/maven/`, is planned but not
live. Switch the Spring fixture to it once it is. Lockfiles keep canonical
registry URLs; see [Development](#development).

The proxy only serves package versions published about a week ago or earlier.
Change dependencies through it (with the committed `.npmrc`), so the lockfile
never pins a version `npm ci` cannot fetch yet.

### Dependency updates

Dependabot opens security updates only (see
[Vulnerabilities in dependencies](#vulnerabilities-in-dependencies)); routine
upgrades are made by hand, in their own pull request. Upgrade through the proxy
so the lockfile only pins versions it serves, then run the gates an upgrade
affects (`npm run check`, `npm run test:rust`, `npm run docs:check` and the
browser suites). Update the vendored shadcn/ui components with
`npm run tools -- update shadcn`. Don't upgrade fixtures' or examples'
manifests: they pin what their tests expect.

### Workflow dependency lockfile

Workflows and this repository's composite actions name each action by its exact
release tag (`actions/checkout@v6.1.0`), and `.github/workflows/actions.lock`,
generated by [`gh actions-lock`](https://github.com/github/gh-actions-lock),
locks every one to its commit, including the actions those actions use; GitHub
Actions refuses to run an action a workflow's lockfile doesn't lock. The
workflows call the composite actions as `$/.github/actions/<name>`, at the
running commit, so their actions are locked too. After adding a workflow or
changing a `uses:`, run `gh actions-lock --ignore-local-actions` and commit the
lockfile with the change; never edit it by hand. CI's `actions-lock` job
verifies it.

- The published action, `action.yml`, keeps its full commit SHAs: the
  repositories that use `githubnext/projections@v0` don't have this lockfile.
  gh-actions-lock 0.4.1 rewrites them to tags
  ([github/gh-actions-lock#298](https://github.com/github/gh-actions-lock/pull/298)),
  so until a release has the fix, regenerate with a build of its `main`.
- action-e2e runs that action as `uses: ./`, from the workspace the job built,
  which the lockfile can't follow (hence `--ignore-local-actions`).
  `.github/actions/action-dependencies`, never run, names its actions at the
  same SHAs so `ci.yml` locks them; a test keeps the two the same.
- dist writes `release.yml`'s actions from `[dist.github-action-commits]` in
  `dist-workspace.toml`, exact tags despite the name, and the download step from
  `.github/release-build-setup.yml`. Change the tag there, run
  `node tools/scripts/dist.mjs`, then `gh actions-lock`.

### Vulnerabilities in dependencies

Known vulnerabilities are gated by GitHub, not by `npm audit`: the proxy doesn't
serve npm's audit endpoint reliably, so `.npmrc` and CI set `audit=false` and no
check calls it.

- **Dependency review** (the `dependency-review` job in
  `.github/workflows/ci.yml`) fails a pull request that adds or upgrades a
  dependency with a known high or critical advisory, in `package-lock.json`,
  `Cargo.lock` or any other manifest GitHub's dependency graph reads.
- **Dependabot** (`.github/dependabot.yml`) opens security updates only: when an
  advisory affects a locked npm package or crate, one pull request per ecosystem
  moves it to a fixed version. Its alerts cover what is already locked. Version
  updates are off (`open-pull-requests-limit: 0`); see
  [Dependency updates](#dependency-updates). Security updates have no cooldown,
  so CI may not be able to install a fix younger than a week until the proxy
  serves it.
- **OSV** (`npm run check:advisories`, the weekly `advisories` job) checks the
  root lockfiles for any known advisory, including maintenance notices. See
  [dependency advisories](docs/maintainers/dependency-advisories.md) for the
  allowed exceptions and the overrides that patch transitive dependencies.

If dependency review flags a change, take a fixed version, or explain in the
pull request why the advisory doesn't apply. Don't dismiss it silently.

### Documentation

Every workspace and crate README starts with front matter whose `description`
says in one line what it is (`---`, `description: …`, `---`, then the title).
`npm run tools -- map` and `context` read it rather than a hand-kept list, and
`npm run check:readmes` (part of `npm run check`) fails without it.

The documentation is this repository's markdown, and it must read correctly on
GitHub: link files and anchors relatively, as GitHub resolves them
(`npm run check:links`, part of `npm run check`, fails on a link or anchor that
doesn't resolve, or a `docs/` page named in source that doesn't exist). A
` ```prompt LABEL ` block is a prompt to paste into a coding agent (GitHub shows
it as a code block); point prompts at the agent prompt files. Images are
repository files (`.png` or `.webp`, with alternative text), published at their
repository paths; the comparator screenshots in `docs/images/comparators` are
drawn by the CLI with `node tools/scripts/comparator-examples.mjs` after
`npm run build`, and the README's and the [gallery](docs/gallery.md)'s in
`docs/images/readme` with `node tools/scripts/readme-images.mjs`, from public
repositories at pinned commits and small projects in `docs/images/sources/`,
such as `docs/images/sources/order-service-split`.

The agent prompt files in [`docs/agents`](docs/agents) are generated from the
Setup pages and `projections help authoring` (the skill `projections init`
writes). The CLI bundles them: `projections help agents NAME` prints one, and
the Setup pages' prompts tell agents to run it rather than fetch a URL. Links
for people go to the Markdown on GitHub through one base URL (`DOCS_BASE` in
`packages/cli/src/docs.rs`,
`packages/integrations/vscode/src/projections/docs.ts` and
`tools/scripts/reference-docs/agents.mjs`). The pages in
[`docs/reference`](docs/reference) are generated from their sources
(`action.yml`, `packages/schemas/`, the renderer SDK's tokens, the built
renderers, the CLI's extractor catalog and the SDKs' public APIs, read by our
own public-API extractors). Never edit them: after `npm run build`, run
`npm run docs:generate` and commit the result. Public CI runs
`npm run docs:check`, which fails when a page is stale. The Rust SDK pages read
rustdoc JSON and need the pinned nightly that
`node tools/scripts/reference-docs.mjs --nightly` prints
(`rustup toolchain install <it> --profile minimal`).

#### Documentation comments

Every public TypeScript symbol needs a TSDoc comment with a summary; internals
get one as needed. A workspace's public API is everything its `package.json`
`exports` reach (or `types`, without `exports`), following re-exports, whether
or not the workspace is published: other workspaces import it too. Wildcard
exports are asset directories and don't count. Members of exported interfaces
and classes need one in the renderer SDK and kit, whose reference pages print a
member table. Say what the symbol is for, its contract and units, and how it
fails or treats edge cases, not its name or type again; put identifiers in
backticks, and give the main entry points an `@example`. Mark a symbol exported
only for tests or tooling `@internal`. Vendored files (an `// Adapted from`
header) are exempt. `npm run check:tsdoc` (part of `npm run check` and
`npm run docs:check`) lists each undocumented symbol as `file:line: message`.

## Boundaries and changes

The versioned [contracts](docs/contracts.md) define the wire formats. Their JSON
Schemas change only additively within a major version, and each release
publishes them to their own host; see
[schema publishing](docs/maintainers/schema-publishing.md). The one npm package,
`@githubnext/projections` (`packages/sdk/`), bundles the renderer SDK, kit,
testing and schemas workspaces for renderer authors; every other workspace is
private ([Packages](docs/contracts/packages.md),
[npm publishing](docs/maintainers/npm-publishing.md)). After changing what it
exports, run `npm run build` and `npm run check:pack --workspace packages/sdk`.
Everything in `packages/` releases together at one version, and workspaces
depend on each other at that exact version; `tools/` and `examples/` stay
private at `0.0.0`. Bump it with `npm run tools -- version <version>`, never by
hand; [releasing](docs/maintainers/releasing.md) describes cutting a release.
Native and Wasm use one Rust semantic implementation; do not introduce a
JavaScript semantic fallback. Keep collection, acquisition, semantic processing
and presentation separate. Browser-safe host and renderer SDK packages must not
import Node execution, authentication or host-specific UI dependencies.

Use [runner and extractor guidance](docs/runner.md) and the language-neutral
examples for new extractors. Supported-domain extractors should not require
adding their names to the Engine. Use synthetic, reproducible fixtures; do not
commit credentials, private source, captured private artifacts or machine state.
Keep generated build output out of source changes.

Describe the behavior changed, its limits and the relevant evidence. Update
directly affected documentation and include regression coverage for fixes.
Publications, deployment, repository administration and credential changes are
not implied by contributing source. First-party contributions are covered by the
repository's [MIT license](LICENSE); preserve third-party notices.

## Licenses and notices

MIT applies to first-party code in this repository; third-party dependencies
retain their own licenses and notices. Every packed workspace includes its
first-party MIT license. Production Inspector browser assets include
`THIRD_PARTY_NOTICES.txt` with full bundled dependency licenses; the Inspector
also carries the engine and generated-validator notices, and
`projections licenses` prints everything the executable includes. Rust crates
whose packages ship no license files fall back to the upstream texts in
[notices/](notices/README.md), which `notices/notices.json` ties to exact locked
versions: `npm run check:notices` fails when such a crate moves to a version it
doesn't cover, until its license is fetched at the matching tag. The
installed-package check (`npm run test:installed`) verifies licenses as well as
real execution. The packed-extractor check (`npm run test:packed`) also verifies
override-free production and optional-dependency-omitted consumers, including
their explicit missing-tool behavior.

Report vulnerabilities and other sensitive defects by email to
opensource-security@github.com, as [SECURITY.md](SECURITY.md) describes, never
in a public issue, discussion or pull request.
