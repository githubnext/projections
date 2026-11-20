# Quick start

Projections shows the systems in your code (dependencies, schemas,
infrastructure, workflows, service wiring) without showing lines of code, and
shows how a change reshapes them. Which projections are worth having depends on
your repository, so setup starts by trying them: **explore your repository in
five minutes**, on its own recent pull requests, then keep the ones that show
something useful and add those to your CI.

**Estimated time: 5 minutes.**

The fastest way to get started is to let your coding agent run the `projections`
CLI and open the results for you in the **Projections viewer**, a page it drives
in your agent's in-app browser or a standalone browser while you watch. Paste
this into your coding agent, or follow the CLI steps below yourself:

```prompt Copy setup prompt
Explore Projections in this repository: run `projections help agents explore` and follow what it prints (if `projections` isn't installed, install it first by following https://github.com/githubnext/projections/blob/main/docs/agents/install.md). Use the projections CLI to find the projections that apply here and try them on our recent pull requests, tell me which are worth keeping, then adopt the ones I pick and show them to me in the Projections viewer. Don't change CI until I say so.
```

Prefer to work right beside your code in an editor? See
[Alternate path: the VS Code extension](#alternate-path-the-vs-code-extension)
below.

## Prerequisites

- **A Git repository** with some history: merged pull requests, or at least a
  few commits.
- **[GitHub CLI](https://cli.github.com)** (`gh`), signed in (`gh auth status`),
  to download and verify the CLI.

## Step 1: Install the CLI

Your coding agent, the terminal, and CI all use the same self-contained
`projections` CLI. Download the release asset for your platform, verify its
attestation, and put it on your `PATH`:

```sh
gh release download --repo githubnext/projections --pattern 'gh-projections-darwin-arm64*'
gh attestation verify gh-projections-darwin-arm64 --repo githubnext/projections
install -m 755 gh-projections-darwin-arm64 ~/.local/bin/projections
projections --version
```

[Install the CLI](install.md) lists every platform's asset, the installer
scripts, Windows instructions, and how to use it as `gh projections`.

## Step 2: Explore your repository

From your repository root, list the projections that apply:

```sh
projections explore
```

Explore looks at the files your repository holds and proposes the projections
that apply, each with why: workspace dependencies when it finds package
manifests, the database when it finds a Prisma schema or a Rails `db/schema.rb`,
a Rails application's routes, the job graph of your Actions workflows, the file
map, and so on. It writes nothing.

To see how each candidate performs on your repository's real history, sweep the
last 20 merges into your branch (or your last commits, if you squash or rebase):

```sh
projections explore --sweep
```

The sweep summarizes, for each projection, how often it changed across those
pull requests and whether it looks noisy (changing on nearly every pull request)
or structural (showing up for pull requests that reshape something). Pass
`--json` for structured output when working with scripts or tools.

Projections whose extractors run your repository's code (some built-in ones use
your toolchain) are listed but skipped until you pass `--trust`. Review what
they run before trusting them.

## Step 3: Adopt the useful ones

Keep the projections worth having by passing their IDs to `adopt`:

```sh
projections adopt prisma-schema workspace-dependencies
```

Adopting writes each projection's definition to `.github/projections/` and
bookmarks the pull requests it showed the most on, so your team can look at them
again (`projections bookmark run`). It never replaces an existing file. Commit
them when you're ready.

To inspect an adopted projection interactively in the Projections viewer, run:

```sh
projections view show -p workspace-dependencies --choice branch --open
```

`--open` launches the viewer in your system browser. When a coding agent drives
the viewer, omit `--open` so it can open the printed URL in its in-app browser
(or in the Copilot canvas if you've installed it). You can also pass
`--choice bookmark:<bookmark>` (`projections bookmark list` shows the bookmarks
`adopt` saved).

Want to see something no built-in projection shows, such as the services in your
own configuration format? [Build your first projection](first-projection.md): a
coding agent writes a small extractor for your codebase and shows you the result
in the viewer.

## Step 4: Add to CI

One step in your CI, the Projections GitHub Action, runs your projections on
every pull request and push. Where it belongs depends on your CI: usually it is
a step in the job that already installs your dependencies and builds, so nothing
is installed twice. Give this prompt to your coding agent, which reads your
workflows, proposes where the step fits, and shows you the change before writing
it:

```prompt Copy Add to CI prompt
Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints.
```

Commit the change and open a pull request: when its run finishes, the run's
summary tells how the pull request reshapes your systems, step by step, and
uploads the projection documents as an artifact. [Add Projections to CI](ci.md)
shows where the step goes and covers reviewing the results, permissions, trust,
and snapshots.

## Alternate path: the VS Code extension

If you prefer an editor-integrated workflow closer to your code, the Projections
VS Code extension offers an alternate experience alongside your files. It isn't
on the Visual Studio Marketplace yet; each
[GitHub release](https://github.com/githubnext/projections/releases) attaches a
`.vsix` per platform, `projections-vscode-<version>-<platform>.vsix` (which
bundles the `projections` CLI; see
[which file](install.md#the-vs-code-extension)). Install it with **Extensions:
Install from VSIX…** in the Command Palette (⇧⌘P / Ctrl+Shift+P), or
`code --install-extension <file>.vsix`. To build from source, see the
[extension's README](../maintainers/vscode-extension.md#develop-and-test).

Once installed, open your repository in VS Code:

- Run **Projections: Explore Repository** from the Command Palette to see the
  sweep as a visual grid, inspect any pull request cell, and tick **Adopt** (or
  run **Projections: Adopt…**). Projections that run repository code wait for VS
  Code's Workspace Trust.
- Click any projection in the **Projections** side bar to open it as a tab that
  reflects your uncommitted edits.
- Use **Add to CI…** in the Explore view (or **Projections: Add to CI…**) to
  hand the CI prompt to your agent, and **Projections: Open Artifact…** to
  inspect a CI run's downloaded artifact.
