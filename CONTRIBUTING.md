# Contributing

Thanks for helping improve Projections. Please follow the
[code of conduct](CODE_OF_CONDUCT.md) as you participate. Everything in the
repository—imports, fixtures, and scripts—must work from a fresh clone without
private repositories, machine-specific paths, or credentials.

## Layout

Anything that ships, or that shipped code depends on, lives under `packages/`.
That includes the CLI, Engine, schemas, comparators, extractors, renderers, the
host (`packages/host/core`, its VS Code UI `packages/host/vscode-ui`, and the
Inspector `packages/host/inspector`), `@githubnext/projections`
(`packages/sdk`), the VS Code extension, the GitHub Action's scripts, and the
agent integrations.

Repository infrastructure stays outside `packages/`: our repo CLI (`tools/cli`),
build, check, and release scripts (`tools/scripts`), Storybook
(`tools/storybook`), the source-checkout `gh` extension launcher
(`tools/gh-projections`), and the workflows. Put a new package in `packages/` if
it ships or something shipped depends on it, and in `tools/` otherwise. Shipped
code must never import from `tools/` at run time, though builds and tests may
use its scripts and Storybook. `action.yml` stays at the repository root where
`uses: githubnext/projections@v0` and the Marketplace look for it. See
[Repository layout](#repository-layout) below for the full directory tree.

## Development

You'll need the Node version in `.node-version` (26.12.1 or later), npm, and
Rustup. The checked-in Rust toolchain selects the right compiler and Wasm target
automatically, and no private SDK or credentials are required. Node is only
build tooling for the browser UI and packages—the CLI itself is a self-contained
native executable that never needs Node at run time.

```sh
npm ci
npm run check
npm run test:rust
npm run test:browser
npm run test:installed
npm run test:binary
npm run test:packed
```

To make daily work faster, the repository's own CLI
([`tools`](tools/cli/README.md)) wraps these commands for both people and
agents:

- `npm run tools -- context` prints a one-screen briefing on the repo.
- `npm run tools -- check --affected` and `npm run tools -- test --affected` run
  just the checks and tests affected by your changes (`npm run tools -- --help`
  lists everything else).
- `npm run tools -- check --fast` runs only the cheap checks over what changed.
- `npm run tools -- build <workspace>` builds a single workspace and any
  out-of-date dependencies, whereas `npm run build` rebuilds the whole repo.
- `npm run tools -- install` builds your checkout and installs it as you'd use
  it day to day: the CLI on `PATH`, the VS Code extension, and the packed npm
  package (see [Early access (from source)](docs/setup/early-access.md)).
- `npm run tools -- feedback "<summary>"` drafts an issue if you hit friction
  with the tooling or these docs.

You can optionally run `npm run tools -- link` to place a `projections-tools`
command on your `PATH` that works from any directory in whichever checkout or
worktree you're in, though `npm run tools --` remains the documented entry
point. In the cloud, GitHub Copilot cloud agent boots from
[`copilot-setup-steps.yml`](.github/workflows/copilot-setup-steps.yml), which
installs the pinned toolchains and dependencies, builds the workspace, and
installs Chromium before the agent's first step.

The browser test suites (`npm run test:browser`) use Playwright's Chromium and
WebKit, which `npm ci` doesn't download. Install them once—and again after
Playwright upgrades—using `--with-deps` on Linux to pull in system libraries:

```sh
npm exec -- playwright install --with-deps chromium webkit
```

After installing, npm 11 warns that esbuild's `postinstall` script (and on
macOS, fsevents' install script) isn't covered by `allowScripts` (run
`npm install-scripts ls` to inspect them). Nothing in this repo needs those
scripts: esbuild locates its platform binary (installed as an optional
dependency) at run time, and its postinstall only verifies that binary and
speeds up startup, while fsevents ships prebuilt. Builds and tests pass without
them, so leave them unapproved—this repository intentionally configures no
`allowScripts`.

Formatting uses [oxfmt](https://oxc.rs/docs/guide/usage/formatter)
(`.oxfmtrc.json`). Run `npm run format` before committing; `npm run check` runs
`format:check`, and ESLint remains the only linter.

Even though installs go through the committed `.npmrc` proxy (see
[Package sources](#package-sources)), lockfiles must always record canonical
`registry.npmjs.org` tarball URLs—npm automatically maps them to the configured
registry when fetching. If an install writes mirror URLs into the lockfile, run
`node tools/scripts/lockfile-registry.mjs --fix` after changing dependencies, as
`npm run check` rejects any other host.

`npm run check` bundles dependency boundaries,
[file standards](docs/maintainers/file-standards.md) (file size, line length,
and complexity via Considered, installed with
`node tools/scripts/considered.mjs install`), builds (including Storybook),
unfiltered TypeScript, lint, and Node tests. Rust and browser suites run
separately. While working on `packages/host/core/` or
`packages/host/vscode-ui/`, run `npm run storybook` to serve Storybook on port
6006, and add a story alongside the existing ones for each new prebuilt view or
building block (see [the Storybook README](tools/storybook/README.md)).

Optional native extractor tests require their documented toolchains and must
fail—never silently pass with empty results—when explicitly enabled without
those tools present. See [runner coverage](docs/maintainers/runner-coverage.md)
for the native and container commands. Changes to the Engine or the default
comparator also need to maintain their coverage and mutation testing bars; see
[testing the Engine](packages/engine/TESTING.md).

If you have GitHub CLI installed, `npm run test:gh` extends `test:installed`
with an isolated local extension install and real CLI execution without touching
your global extensions or GitHub credentials. Public CI runs that superset,
though ordinary CLI usage doesn't require `gh`. Separately,
`npm run test:binary` verifies `packages/cli/dist/projections` moved into an
empty directory with no Node on PATH (pass `-- --binary FILE` to verify a
release asset).

When iterating, run the fastest checks first and widen gradually: start with
`tools check --fast` (format, lint, `cargo check`, and typecheck of what
changed), run `tools build <workspace>` if a test needs built output, run the
narrowest test with `tools test <target> --filter <name>`, and only then run
`tools check --affected`, `tools test --affected`, and full `npm run check`.
Catching a compile error in `--fast` takes seconds instead of burning minutes—or
waiting for a build slot on a shared machine—in a full build or test run. Keep
strict error, cancellation, geometry, progress, and input-validation assertions
intact. Treat every failure as evidence to diagnose, never as a reason to
stretch a deadline, drop a frame, swap in a fixture for an enabled native test,
or silently return an empty model.

### Faster local builds (optional)

Because each checkout and worktree compiles Rust dependencies into its own
`target/` directory, a shared compile cache like
[sccache](https://github.com/mozilla/sccache) lets new worktrees reuse
dependencies another checkout already built. It's a local machine preference,
not a repo requirement:

```toml
# ~/.cargo/config.toml
[build]
rustc-wrapper = "/path/to/sccache"
```

Configure the cache size in sccache's own config (`[cache.disk] size`, which
defaults to 10 GiB). Setting `client_side_mode = true` runs each compile as a
child of Cargo so memory is accounted against the build that triggered it.
sccache caches dependency crates—not workspace crates (which already build
incrementally), procedural macros, or crates whose inputs embed the checkout
path (such as anything reading `OUT_DIR`, like `serde` and `thiserror`, and
crates above them). Run `sccache --show-stats` to inspect hit rates.

Also note that `npm ci` rebuilds `node_modules` from npm's local cache, so it's
file-system bound rather than network bound. You only need to run it in a fresh
checkout or when the lockfile changes (`npm run tools -- doctor` will tell you
when).

### Continuous integration

CI verifies import and dependency boundaries, TypeScript, correctness-focused
ESLint rules, real native-engine artifact tests, and explicit Rust and browser
suites. Generated files are never linted as authored code. CI runs the same
public composite action on both Linux and macOS, so passing locally on macOS
doesn't guarantee those remote matrix jobs will pass. Rust suites run with
[cargo-nextest](https://nexte.st)—giving each test its own process via
`npm run test:rust:nextest`, while `.config/nextest.toml` keeps the .NET suites
serialized because they share a published helper—and restore dependency build
outputs from a cache populated on pushes to `main`.

- **Linux** runs the browser suites in dedicated jobs (sharding the larger
  ones), enables all optional native extractor suites, and runs the real Docker
  policy and digest-parity check described in
  [runner coverage](docs/maintainers/runner-coverage.md).
- **Windows** splits work across three jobs: `windows` runs the Rust suites
  natively (including Job Object supervision of extractor process trees),
  `windows-node` runs every Node suite, the installed-package proof, and
  file-system checks, and `windows-integration` runs the CLI browser suite, a
  renderer smoke test, the VS Code extension in VS Code, and the GitHub Action
  end to end.
- **macOS** splits its composite action into two parallel jobs (Rust suites and
  everything else) and also runs the renderers in WebKit.

Tests that can't run on a given platform are skipped or ignored with an explicit
reason, and the release workflow runs `npm run test:binary` on every platform.
See [platform coverage](docs/maintainers/runner-coverage.md#platform-coverage)
for the full matrix.

Shipped code must stay OS-neutral. `npm run check:portability` flags POSIX
shells and paths, command strings executed through a shell, platform-specific
launchers (like `npm` without its `.cmd` shim, or `python3`), native paths
treated as POSIX paths, and text splitting that ignores CRLF. Record any
intentional exception in `.portability.yaml` with its justification.

#### What CI runs

Pull requests run only the jobs their changes reach. All scheduling decisions
live in [`.github/ci-rules.json`](.github/ci-rules.json), where every rule
carries a description; its schema (`.github/ci-rules.schema.json`) is generated
from `tools/cli/src/lib/ci-rules.schema.ts` via
`node tools/scripts/ci-schemas.mjs`. The workflow's first job, `changes`, runs
`tools/scripts/ci-plan.mjs` to evaluate those rules against the changed files
and their position in the dependency graph, then prints a summary: each file's
class and why, the workspaces and crates it touches and reaches, and each job
with the rule descriptions that ran it.

The planner evaluates in this order:

1. **Each changed file gets one class**, and nothing else happens to it. The
   first rule in `files` whose paths match it gives the class. A `docs` file
   that a crate reads by path, or a generator reads or writes, is `checks`
   instead (the Linux checks run every crate's tests and generator's check). A
   file no rule matches is `code` when a workspace or crate contains it or
   anything reads it, and `full` otherwise. The classes:
   - `full`: run everything.
   - `docs`: documentation; a change of only docs files runs the `docs` job
     alone.
   - `checks`: the Linux checks alone.
   - `code`: touches the workspace or crate containing the file and those that
     read it by path (`include_str!`, `CARGO_MANIFEST_DIR`, a renderer's
     `scenarios.json`); with neither, the Linux checks alone.
   - `lockfile` (`package-lock.json`, `Cargo.lock`): `code` for the workspaces
     and crates whose resolved dependencies changed compared with the merge
     base, and `full` when the root's own tooling changed.
2. **A full run runs every job**, whatever its `when` says: pushes to `main`,
   the nightly run, manual runs, the `ci:full` label, and any `full` file.
3. **Touched and reached units.** The `code` files give the touched workspaces
   and crates. Those, and everything depending on one that contains or builds in
   a changed file, are reached. A crate whose tests alone read a file is touched
   (its own suites run), but its dependants aren't reached through it.
4. **Each job's `when`** is evaluated against the changed paths and the touched
   and reached units. `{"changes": globs}` looks at paths whatever their class:
   `action.yml` is `code` and also selects the jobs whose `changes` name it, and
   `Cargo.lock` is a lockfile and also a Rust change.
5. **Browser suites.** Each suite runs when the change reaches it or a workspace
   its `test:browser` script builds, or when its own `when` holds. Suites with
   `shards` run in their own jobs; the rest share `browser (rest)`. The renderer
   harness's `narrow` leaves the other renderers' tests out when only some
   renderers changed.

A `when` is `"always"`, `"never"` (full runs only), `"docsOnly"`,
`{"if": condition}`, `{"changes": globs}` (or
`{"changes": {"facts": "mutants"}}`, the files `.cargo/mutants.toml` examines),
`{"touches": group}`, `{"reaches": group}`, `{"any": [...]}` or `{"not": ...}`.
`groups` name sets of workspaces and crates by glob, `@group`,
`{"kind": "crate"}` or a fact the repository states elsewhere
(`{"facts": "coverage"}`, the crates `test:rust:coverage` measures).
`conditions` name the predicates jobs share, such as `rust` and `platform`.

The graph comes from code: `ci-facts.ts` reads the graph `tools affected` does,
plus edges no manifest declares: files read by path, what a workspace's `build`
script compiles, and renderers under the harness's `testDir`.

To change what runs, update the rules file and add a test case to
`tools/cli/test/ci-plan.cases.json`. Running `npm run tools -- test tools/cli`
validates the file against its schema, verifies that every referenced group,
condition and suite exists, confirms `ci.yml` gates each job on the matching
decision name, and executes every case. Any change to the rules file itself runs
the full suite.

Everything also runs on pushes to `main`, nightly, on manual runs (**Run
workflow** on the Projections workflow), and when a pull request carries the
`ci:full` label (add the label, then push or re-run the workflow so the plan
sees it).

`ci-ok` is the single required check. It passes when `changes` succeeds and
every other job either passes or is skipped by the plan; any failed, cancelled,
or timed-out job fails it. To preview what your current branch would trigger
(including uncommitted changes against `origin/main`), run
`node tools/scripts/ci-plan.mjs`.

`dollarlint` runs on every change, outside the plan; see below.

### Schemas for data files

Every JSON, YAML and TOML file is validated against a schema by
[DollarLint](https://dollarlint.dev), configured in `.dollarlint.toml`: run
`dollarlint validate .` (after `npm ci`, which installs the schema
`.oxfmtrc.json` names). CI's `dollarlint` job runs it on every change and sends
its findings to code scanning. A file gets its schema from its own declaration
(`$schema`, or a `# yaml-language-server: $schema=` comment), from an
association in `.dollarlint.toml`, or from SchemaStore's catalog. Our own
formats use the schemas in `packages/schemas`, read from the checkout rather
than fetched (`[[schemas.mappings]]`), so a change is checked against its own
schemas, before and after the schemas host serves them. `requireCoverage` fails
a file with no schema, so a new kind of data file needs one, in TypeBox in
`packages/schemas` (`src/typebox` for a published format, `src/repository` for
the repository's own files), and an association. A file no schema can describe,
such as a third-party format with none published, is excluded in
`.dollarlint.toml` with its reason.

## Repository layout

The repository is organized by domain component; language only determines what
is inside each directory. Everything that ships, or that something shipped
depends on, is in `packages/`; the repository's own tooling is in `tools/`:

```
packages/
  schemas/       language-neutral contracts (JSON Schema, TypeScript types) and the conformance corpus
  machine/       explicit state machines for the hosts' and integrations' lifecycles, with an actor and a test kit
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

The CLI and Inspector backend are native Rust, built with Clap and linked
directly against the shared Engine, while the VS Code extension drives that
backend over `projections serve --stdio`. Alongside them sit the default
comparator (compiled natively and as a zero-import Wasm module), the comparator
rules interpreter, the polyglot extractor runner, built-in extractor sources,
custom extractor samples, a browser host with sandboxed renderer frames, and
shared verified artifact loading. Capability acceptance stays decoupled from
source availability, and public components never import files outside this
repository.

## Invariants

Every change must uphold these rules (you can print them anytime with
`npm run tools -- context`):

- One Rust semantic implementation (the Engine) serves both native and Wasm
  hosts; never add a JavaScript semantic fallback.
- Collection, acquisition, semantic processing (validation, matching, hashing),
  and presentation remain separate.
- Extractor toolchains are optional. Anything that renders CI artifacts consumes
  them as data and never executes repository extractors.
- Browser-safe packages (schemas, renderers, host, host-vscode) never import
  Node execution, authentication, extractors, or host-specific UI dependencies,
  and nothing depends on a design system (`npm run check:boundaries`).
- Workspaces depend strictly downward: schemas, Engine, renderer SDK, kit,
  built-in renderers, hosts, Inspector, then the VS Code extension and CLI. A
  workspace may only import first-party packages it declares, and never reach
  into another workspace's shipped `src/` by path (see the layer table in
  `tools/scripts/check-boundaries/layers.mjs`).
- First-party extractors, comparators, and renderers use the same public SDKs as
  third parties.
- Lifecycles in the hosts and integrations are modeled as explicit state
  machines (`packages/machine`), each backed by an `explore` test;
  `npm run check:machines` keeps implicit state from creeping back in.
- Generated files are never edited by hand; update their sources and regenerate
  with `npm run tools -- generated`.
- JSON Schemas evolve strictly additively within a major version.
- Packages install through the committed `.npmrc` registry rather than directly
  from the public npm registry.
- A failing check is evidence to investigate, not a reason to loosen a deadline,
  drop an assertion, or substitute a fixture.
- Fixtures stay synthetic and reproducible, with no credentials, private source,
  or machine state.

## Package sources

Both contributors and CI fetch npm, PyPI, and NuGet packages through Microsoft's
public package feed proxy. It mirrors the public registries anonymously—no
account, token, or extra setup needed—so you get the same packages while
satisfying our CI machines' network policy and keeping local installs identical
to CI. The committed configuration below selects the proxy and never falls back
to registry.npmjs.org or nuget.org directly. Tests that install outside the
workspace (like scratch projects and packed-package proofs) forward the
workspace's registry setting.

<!-- prettier-ignore -->
| Ecosystem | Feed | Configured in |
| --- | --- | --- |
| npm | `https://packagefeedproxy.microsoft.io/npm/` | `.npmrc`; CI also sets `npm_config_registry` for installs outside the workspace |
| PyPI | `https://packagefeedproxy.microsoft.io/pypi/simple/` | `PIP_INDEX_URL` in CI (the Django helper's requirements) |
| NuGet | `https://packagefeedproxy.microsoft.io/nuget/v3/index.json` | `nuget.config`, and the `--source` of the native suites' own restores |
| Maven | Maven Central and the Gradle Plugin Portal | The Spring fixture's `pom.xml`, `build.gradle` and `settings.gradle` (the defaults) |

Because pip has no committed config file here, set `PIP_INDEX_URL` the same way
CI does when running the native Django suite locally. Maven currently uses Maven
Central because the proxy's Maven endpoint
(`https://packagefeedproxy.microsoft.io/maven/`) is planned but not live yet;
we'll switch the Spring fixture over once it is. Lockfiles still record
canonical registry URLs (see [Development](#development)).

Note that the proxy only serves versions published about a week ago or earlier.
Always update dependencies through the proxy (via the committed `.npmrc`) so the
lockfile never pins a brand-new version that `npm ci` can't fetch yet.

### Dependency updates

Dependabot only opens security updates (see
[Vulnerabilities in dependencies](#vulnerabilities-in-dependencies)); routine
dependency upgrades are done manually in dedicated pull requests. Upgrade
through the proxy so the lockfile only pins versions it serves, then run the
affected checks (`npm run check`, `npm run test:rust`, `npm run docs:check`, and
the browser suites). Update vendored shadcn/ui components with
`npm run tools -- update shadcn`. Leave fixture and example manifests untouched,
as they pin versions their tests expect.

### Workflow dependency lockfile

Workflows and composite actions reference each action by its exact release tag
(`actions/checkout@v6.1.0`), while `.github/workflows/actions.lock`—generated by
[`gh actions-lock`](https://github.com/github/gh-actions-lock)—pins every action
(including transitive ones) to its commit SHA. GitHub Actions refuses to run any
action missing from that lockfile. Workflows invoke local composite actions as
`$/.github/actions/<name>` at the running commit so their dependencies are
locked too. Whenever you add a workflow or change a `uses:` line, run
`gh actions-lock --ignore-local-actions` and commit the updated lockfile rather
than editing it by hand. CI's `actions-lock` job enforces this.

A few special cases to know about:

- The published `action.yml` keeps full commit SHAs because downstream
  repositories using `githubnext/projections@v0` don't have our lockfile.
  Because gh-actions-lock 0.4.1 rewrites them to tags
  ([github/gh-actions-lock#298](https://github.com/github/gh-actions-lock/pull/298)),
  regenerate with a build from its `main` branch until a release includes that
  fix.
- action-e2e invokes our action locally as `uses: ./`, which the lockfile can't
  follow (that's why we pass `--ignore-local-actions`). A dummy action at
  `.github/actions/action-dependencies` lists the same action SHAs so `ci.yml`
  locks them, and a test ensures the two stay in sync.
- dist generates `release.yml`'s action pins from `[dist.github-action-commits]`
  in `dist-workspace.toml` (exact tags despite the table name) and the download
  step from `.github/release-build-setup.yml`. Update tags there, run
  `node tools/scripts/dist.mjs`, and then re-run `gh actions-lock`.

### Vulnerabilities in dependencies

GitHub handles vulnerability gating here rather than `npm audit`—the package
proxy doesn't reliably serve npm's audit endpoint, so `.npmrc` and CI set
`audit=false` and no check calls it.

- **Dependency review** (the `dependency-review` job in
  `.github/workflows/ci.yml`) blocks any pull request that adds or upgrades a
  dependency with a known high or critical advisory in `package-lock.json`,
  `Cargo.lock`, or any other manifest GitHub's dependency graph inspects.
- **Dependabot** (`.github/dependabot.yml`) opens security updates only,
  grouping fixes into one pull request per ecosystem when an advisory affects a
  locked npm package or Rust crate, and alerting on what's already locked.
  Routine version updates are disabled (`open-pull-requests-limit: 0`; see
  [Dependency updates](#dependency-updates)). Because security updates have no
  cooldown, CI may need to wait up to a week before the proxy serves a brand-new
  fix.
- **OSV** (`npm run check:advisories`, run in the weekly `advisories` job) scans
  root lockfiles for any known advisory, including maintenance notices. See
  [dependency advisories](docs/maintainers/dependency-advisories.md) for allowed
  exceptions and overrides patching transitive dependencies.

If dependency review flags your change, upgrade to a fixed version or explain in
the pull request why the advisory doesn't apply—never dismiss it silently.

### Documentation

Every workspace and crate README must begin with front matter containing a
one-line `description` (`---`, `description: …`, `---`, followed by the title).
`npm run tools -- map` and `context` read this metadata instead of a
hand-maintained list, and `npm run check:readmes` (part of `npm run check`)
enforces it.

All documentation is plain Markdown in this repository and must render cleanly
on GitHub. Use relative links for files and anchors so GitHub resolves them;
`npm run check:links` (also part of `npm run check`) catches broken links,
missing anchors, and any `docs/` path referenced in source code that doesn't
exist. A ` ```prompt LABEL ` fence marks a prompt meant to be pasted into a
coding agent (GitHub renders it as a code block) and should point at the agent
prompt files.

Images live in the repository as `.png` or `.webp` files with alt text and are
referenced by their repository paths. After `npm run build`, regenerate the
comparator screenshots in `docs/images/comparators` with
`node tools/scripts/comparator-examples.mjs`, and regenerate the README and
[gallery](docs/gallery.md) images in `docs/images/readme` with
`node tools/scripts/readme-images.mjs` (which renders public repositories at
pinned commits and small sample projects under `docs/images/sources/`, like
`docs/images/sources/order-service-split`).

The agent prompt files under [`docs/agents`](docs/agents) are generated from the
Setup pages and `projections help authoring` (the skill `projections init`
writes). The CLI embeds them so `projections help agents NAME` prints them
directly, and prompts in the Setup pages tell agents to run that command rather
than fetching URLs. Human-facing links point to GitHub Markdown through a single
base URL (`DOCS_BASE` in `packages/cli/src/docs.rs`,
`packages/integrations/vscode/src/projections/docs.ts`, and
`tools/scripts/reference-docs/agents.mjs`).

Reference pages under [`docs/reference`](docs/reference) are generated from
their sources (`action.yml`, `packages/schemas/`, renderer SDK tokens, built
renderers, the CLI extractor catalog, and the SDKs' public APIs read by our own
public-API extractors). Never edit them by hand—after `npm run build`, run
`npm run docs:generate` and commit the output. Public CI runs
`npm run docs:check` to catch stale pages. Generating the Rust SDK pages reads
rustdoc JSON and requires the pinned nightly printed by
`node tools/scripts/reference-docs.mjs --nightly` (install it with
`rustup toolchain install <it> --profile minimal`).

#### Documentation comments

Every public TypeScript symbol needs a TSDoc comment with a summary; add
comments to internals wherever helpful. A workspace's public API is everything
reachable from its `package.json` `exports` (or `types` when `exports` is
absent), following re-exports—even for private workspaces, since other
workspaces import them. Wildcard exports point to asset directories and don't
count. In the renderer SDK and kit, members of exported interfaces and classes
also need TSDoc comments because their reference pages generate member tables.

Focus each comment on what the symbol is for, its contract and units, and how it
handles errors or edge cases rather than repeating its name or type. Wrap
identifiers in backticks and add an `@example` to main entry points. Mark
symbols exported solely for tests or tooling with `@internal`. Vendored files
(marked with an `// Adapted from` header) are exempt. `npm run check:tsdoc`
(included in `npm run check` and `npm run docs:check`) reports missing comments
as `file:line: message`.

## Boundaries and changes

The versioned [contracts](docs/contracts.md) define our wire formats. Their JSON
Schemas only evolve additively within a major version, and each release
publishes them to their own host (see
[schema publishing](docs/maintainers/schema-publishing.md)). Our single npm
package, `@githubnext/projections` (`packages/sdk/`), bundles the renderer SDK,
kit, testing, and schemas workspaces for renderer authors; every other workspace
stays private (see [Packages](docs/contracts/packages.md) and
[npm publishing](docs/maintainers/npm-publishing.md)). Whenever you change its
exports, run `npm run build` and `npm run check:pack --workspace packages/sdk`.

Everything under `packages/` releases in lockstep at one version, with
workspaces depending on each other at that exact version, while `tools/` and
`examples/` stay private at `0.0.0`. Bump versions with
`npm run tools -- version <version>` rather than editing files by hand (see
[releasing](docs/maintainers/releasing.md) for the release process). Keep native
and Wasm on the single Rust semantic implementation without adding a JavaScript
fallback, keep collection, acquisition, semantic processing, and presentation
separate, and ensure browser-safe host and renderer SDK packages never import
Node execution, authentication, or host-specific UI dependencies.

Follow [runner and extractor guidance](docs/runner.md) and the language-neutral
examples when building new extractors; supported-domain extractors shouldn't
need their names added to the Engine. Keep fixtures synthetic and reproducible—
never commit credentials, private source, captured private artifacts, or machine
state—and keep generated build output out of source changes.

When opening a pull request, describe what behavior changed, its limits, and the
evidence backing it. Update any directly affected docs and include regression
tests for fixes. Contributing source does not imply publication, deployment,
repository administration, or credential changes. First-party contributions fall
under the repository's [MIT license](LICENSE); keep third-party notices intact.

## Licenses and notices

First-party code in this repository is MIT-licensed, while third-party
dependencies keep their own licenses and notices. Every packed workspace ships
its first-party MIT license. Production Inspector browser assets bundle full
dependency licenses in `THIRD_PARTY_NOTICES.txt`, the Inspector also carries
engine and generated-validator notices, and `projections licenses` prints
everything bundled into the executable.

For Rust crates that don't ship license files in their packages, we keep
upstream texts in [notices/](notices/README.md), pinned to exact locked versions
in `notices/notices.json`. When one of those crates updates,
`npm run check:notices` fails until you fetch its license at the matching tag.
`npm run test:installed` verifies both licenses and real execution, while
`npm run test:packed` verifies override-free production and
optional-dependency-omitted consumers, including their explicit missing-tool
errors.

Please report vulnerabilities and other sensitive security issues by email to
opensource-security@github.com as described in [SECURITY.md](SECURITY.md)—never
in a public issue, discussion, or pull request.
