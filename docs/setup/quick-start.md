# Quick start

Projections shows the systems in your code (dependencies, schemas,
infrastructure, workflows, service wiring) without showing lines of code, and
shows how a change reshapes them. Which projections are worth having depends on
your repository, so setup starts by trying them: **explore your repository in
five minutes**, on its own recent pull requests, then keep the ones that show
something useful and add those to your CI.

**Estimated time: 5 minutes.**

Paste this into your coding agent, or follow the steps below yourself:

```prompt Copy setup prompt
Explore Projections in this repository: run `projections help agents explore` and follow what it prints (if `projections` isn't installed, install it first by following https://github.com/githubnext/projections/blob/main/docs/agents/install.md). Use the projections CLI to find the projections that apply here and try them on our recent pull requests, tell me which are worth keeping, then adopt the ones I pick and show them to me in the Projections viewer. Don't change CI until I say so.
```

Your agent works with the `projections` CLI and opens the projections for you in
the Projections viewer, a page in your browser that it drives while you watch.
Or follow the steps below to do it yourself in VS Code.

## Prerequisites

- **A Git repository** with some history: merged pull requests, or at least a
  few commits.
- **[VS Code](https://code.visualstudio.com)**.
- **[GitHub CLI](https://cli.github.com)** (`gh`), signed in (`gh auth status`),
  to download and verify the CLI.

## Step 1: Install the VS Code extension

The Projections extension is where you explore, inspect and adopt projections,
beside your code. It isn't on the Visual Studio Marketplace yet; publishing it
there comes later. Until then, every
[GitHub release](https://github.com/githubnext/projections/releases) attaches it
as a `.vsix` for each platform, `projections-vscode-<version>-<platform>.vsix`
([which file](install.md#the-vs-code-extension)): install it with **Extensions:
Install from VSIX…** in the Command Palette (⇧⌘P / Ctrl+Shift+P), or
`code --install-extension <file>.vsix`. To run the extension from source, build
it from the repository: the
[extension's README](../maintainers/vscode-extension.md#develop-and-test) has
the steps.

The extension runs the `projections` CLI, which is also what your coding agent,
the terminal and CI use. The release's `.vsix` for your platform bundles it;
otherwise the extension uses `projections` on your `PATH`, or the executable the
`projections.cliPath` setting names. Download the release asset for your
platform, verify it, and put it on your `PATH`:

```sh
gh release download --repo githubnext/projections --pattern 'gh-projections-darwin-arm64*'
gh attestation verify gh-projections-darwin-arm64 --repo githubnext/projections
install -m 755 gh-projections-darwin-arm64 ~/.local/bin/projections
projections --version
```

[Install the CLI](install.md) lists every platform's asset, the installer
scripts, Windows instructions and how to use it as `gh projections`.

## Step 2: Explore your repository

Open your repository in VS Code and run **Projections: Explore Repository** from
the Command Palette.

Explore looks at the files your repository holds and proposes the projections
that apply, each with why: workspace dependencies when it finds package
manifests, the database when it finds a Prisma schema or a Rails `db/schema.rb`,
a Rails application's routes, the job graph of your Actions workflows, the file
map, and so on. It writes nothing. The **Explore** view lists them and runs each
projection on the last 20 merges into your branch (or your last commits, if you
squash or rebase).

The grid shows, for every pull request, what each projection saw: how many
changes, a small picture of its diff, and "No change" where it saw nothing. Each
column says how often that projection changed and whether it looks noisy (it
changes on nearly every pull request) or structural (it shows up for the pull
requests that reshape something). Open a cell to see that pull request in the
Inspector, where you can change the projection's renderer and options live.

Projections whose extractors run your repository's code (some built-in ones use
your toolchain) are listed but skipped until you trust the workspace (VS Code's
Workspace Trust). Review what they run first.

Prefer the terminal, or working with an agent? `projections explore` lists the
candidates, `projections explore --sweep` prints the same results as the grid
(`--trust` runs the ones that run repository code), and `--json` gives them to
tools.

## Step 3: Adopt the useful ones

Tick **Adopt** on the projections worth keeping in the Explore view, preview,
and write (or run **Projections: Adopt…**). Or, in the terminal:

```sh
projections adopt prisma-schema workspace-dependencies
```

Adopting writes each projection's definition to `.github/projections/` and
bookmarks the pull requests it showed the most on, so your team can look at them
again (`projections bookmark run`). It never replaces a file. Commit them.

Want to see something no built-in projection shows, such as the services in your
own configuration format? [Build your first projection](first-projection.md): a
coding agent writes a small extractor for your codebase.

## Step 4: Add to CI

One step in your CI, the Projections GitHub Action, runs your projections on
every pull request and push. Where it belongs depends on your CI: usually it is
a step in the job that already installs your dependencies and builds, so nothing
is installed twice. **Add to CI…** in the Explore view (or **Projections: Add to
CI…**) hands this prompt to your coding agent, which reads your workflows,
proposes where the step fits and shows you the change before writing it:

```prompt Copy Add to CI prompt
Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints.
```

Commit the change and open a pull request: when its run finishes, the run's
summary tells how the pull request reshapes your systems, step by step, and its
artifact opens in VS Code with **Projections: Open Artifact…**.
[Add Projections to CI](ci.md) shows where the step goes and covers reviewing
the results, permissions, trust and snapshots.
