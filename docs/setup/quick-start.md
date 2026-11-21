# Quick start

Projections maps the systems inside your codebase—dependencies, schemas,
infrastructure, workflows, service wiring—without making you wade through lines
of code, and shows how a change reshapes them. Because the right projections
depend on your repository, setup starts by **exploring your repository in five
minutes** against its own recent pull requests. From there, you keep the ones
that actually tell you something useful and wire those into CI.

**Estimated time: 5 minutes.**

The quickest route is to let your coding agent run the `projections` CLI and
open the results in the **Projections viewer**, a local page it drives in your
agent's in-app browser or a standalone browser while you watch. Paste this into
your coding agent, or follow the CLI steps below yourself:

```prompt Copy setup prompt
Explore Projections in this repository: run `projections help agents explore` and follow what it prints (if `projections` isn't installed, install it first by following https://github.com/githubnext/projections/blob/main/docs/agents/install.md). Use the projections CLI to find the projections that apply here and try them on our recent pull requests, tell me which are worth keeping, then adopt the ones I pick and show them to me in the Projections viewer. Don't change CI until I say so.
```

If you'd rather work right beside your code inside an editor, jump to
[Alternate path: the VS Code extension](#alternate-path-the-vs-code-extension)
below.

## Prerequisites

- **A Git repository** with some history—merged pull requests, or at least a few
  commits.
- **[GitHub CLI](https://cli.github.com)** (`gh`), signed in (`gh auth status`),
  so you can download and verify the CLI binary.

## Step 1: Install the CLI

Your coding agent, your terminal, and CI all run the same self-contained
`projections` CLI. Download the release asset for your platform, verify its
attestation, and place it on your `PATH`:

```sh
gh release download --repo githubnext/projections --pattern 'gh-projections-darwin-arm64*'
gh attestation verify gh-projections-darwin-arm64 --repo githubnext/projections
install -m 755 gh-projections-darwin-arm64 ~/.local/bin/projections
projections --version
```

See [Install the CLI](install.md) for every platform's asset, installer scripts,
Windows steps, and how to run it as `gh projections`.

## Step 2: Explore your repository

From the root of your repository, ask Projections which built-ins apply:

```sh
projections explore
```

This inspects your files without writing anything and proposes matching
projections along with why each one fits—workspace dependencies if it finds
package manifests, a database schema if it spots a Prisma schema or a Rails
`db/schema.rb`, Rails routes, your GitHub Actions job graph, a file map, and so
on.

Next, test those candidates against real history by sweeping the last 20 merges
into your branch (or your most recent commits if you squash or rebase):

```sh
projections explore --sweep
```

The sweep reports how often each projection changed across those pull requests
and distinguishes noisy ones (changing on nearly every pull request) from
structural ones (showing up only when a change reshapes something). Pass
`--json` if you want structured output for scripts or tools.

Any projection whose extractor executes repository code (including some
built-ins that invoke your toolchain) is listed in the output but skipped until
you pass `--trust`. Review what those extractors run before trusting them.

## Step 3: Adopt the useful ones

Once you've decided which projections are worth keeping, adopt them by ID:

```sh
projections adopt prisma-schema workspace-dependencies
```

Adopting writes each projection's definition into `.github/projections/` and
bookmarks the pull requests where it showed the most change, so your team can
revisit them later with `projections bookmark run`. It never overwrites existing
files, and you can commit the definitions whenever you're ready.

To inspect an adopted projection interactively in the Projections viewer, run:

```sh
projections view show -p workspace-dependencies --choice branch --open
```

Passing `--open` launches the viewer in your system browser. When a coding agent
drives the viewer, omit `--open` so it can open the printed URL in its in-app
browser (or in the Copilot canvas if you've installed it). You can also view a
saved bookmark with `--choice bookmark:<bookmark>`—run
`projections bookmark list` to see the bookmarks `adopt` created.

Need a view that no built-in covers, like services defined in a custom config
format? Head to [Build your first projection](first-projection.md), where a
coding agent writes a small extractor tailored to your codebase and shows you
the result in the viewer.

## Step 4: Add to CI

Adding the Projections GitHub Action runs your adopted projections on every pull
request and push. Because the best place for that step depends on how your
workflows are structured—usually inside the job that already installs
dependencies and builds, so nothing gets installed twice—you can let your coding
agent read your workflows, suggest where it belongs, and show you the diff
before editing anything:

```prompt Copy Add to CI prompt
Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints.
```

Commit the workflow change and open a pull request. Once the run finishes, the
job summary explains step by step how the pull request reshapes your systems and
uploads the projection documents as an artifact. For placement tips, reviewing
results, permissions, trust, and snapshots, see [Add Projections to CI](ci.md).

## Alternate path: the VS Code extension

If you'd rather work directly beside your code in an editor, the Projections VS
Code extension provides an alternate workflow inside VS Code. It isn't on the
Visual Studio Marketplace yet; instead, each
[GitHub release](https://github.com/githubnext/projections/releases) attaches a
per-platform `.vsix`, `projections-vscode-<version>-<platform>.vsix`, which
bundles the `projections` CLI (see
[which file to download](install.md#the-vs-code-extension)). Install it via
**Extensions: Install from VSIX…** in the Command Palette (⇧⌘P / Ctrl+Shift+P),
or run `code --install-extension <file>.vsix`. To build it from source, follow
the [extension's README](../maintainers/vscode-extension.md#develop-and-test).

Once it's installed, open your repository in VS Code:

- Run **Projections: Explore Repository** from the Command Palette to browse the
  sweep as a visual grid, inspect any pull request cell, and check **Adopt** (or
  run **Projections: Adopt…**). Projections that run repository code wait for VS
  Code's Workspace Trust.
- Click any projection in the **Projections** side bar to open it in a tab that
  updates alongside your uncommitted edits.
- Use **Add to CI…** in the Explore view (or **Projections: Add to CI…**) to
  pass the CI prompt to your agent, and **Projections: Open Artifact…** to
  inspect a downloaded CI artifact.
