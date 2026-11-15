# Build your first projection

Describe the system you want to see to your coding agent, and it builds a
projection that shows it: an extractor in your project's own toolchain, drawn by
a renderer that fits. Paste this into your coding agent, replacing the
description with what you want to see:

```prompt Copy projection prompt
Create a projection for this repository: run `projections help agents create-projection` and follow what it prints.
It should show: the services in services/*/app.yaml and which services each one calls.
```

You need the [CLI](install.md) on your PATH. The agent shows you the projection
in the Projections viewer, a page in your browser that it drives while you
watch; to watch it take shape in your editor, use the
[VS Code extension](quick-start.md#step-1-install-the-vs-code-extension). The
rest of this page is what the agent does, step by step, so you can follow along
or do it yourself.

Every codebase is unusual somewhere: a home-grown plugin registry, services
wired together in YAML, feature flags with owners. Built-in projections can't
know about those. A custom projection can, and a coding agent can build one for
you from a short description. For systems built-in extractors already read
(package dependencies, database schemas, infrastructure, Actions workflows),
[explore](quick-start.md#step-2-explore-your-repository) first: they need no
code, and explore shows how they do on your pull requests before you keep any.

Each of a projection's three parts is customized separately, and each is built
differently:

<!-- prettier-ignore -->
| Part | Usually | Built with |
|---|---|---|
| **Extractor** | Custom: it is how Projections learns your codebase | Your project's own toolchain and language. Projections never needs Node for it |
| **Renderer** | Built-in, chosen to fit the extraction's schema | When custom: web development, a TypeScript, Vite and React package using the renderer SDK and kit |
| **Comparator** | Default, perhaps configured | When custom: a comparator file of declarative rules (YAML and CEL), with its tests |

Start with a custom extractor that emits a standard schema and a built-in
renderer; add a custom renderer only when no built-in one draws the picture your
system needs.

## 1. Scaffold it

```sh
projections init service-map
```

`init` writes a working projection you can run immediately, and never overwrites
your files:

<!-- prettier-ignore -->
| File | What it is |
|---|---|
| `.github/projections/service-map.json` | The definition: title, extractor command and renderer (`graph` unless `--renderer` names another) |
| `.github/projections/service-map/extract.mjs` | A starter extractor in your project's toolchain: Node for `package.json`; Python (`extract.py`) for `pyproject.toml`, `requirements.txt`, `setup.py` or `Pipfile`; Go (`extract.go`) for `go.mod`. `--language` chooses, and `--command` uses a program you already have, in any language |
| `.agents/skills/projections/SKILL.md` | The skill a coding agent loads to build and verify a projection here, updated by every run of `init`. `--claude` adds it for Claude Code; [agent skills](agent-skills.md) says which agents read which directory |

The starter shows your top-level directories, so you can see the whole loop work
before changing anything:

```sh
projections show -p service-map --trust
```

prints it as text. To see it, open the repository in VS Code (trust the
workspace, since the extractor is repository code), open the **Projections**
side bar and click the projection: it opens as a tab, like a file. The side
bar's **Viewing** view chooses what every projection tab shows: **Current
state** (your files alone), **Uncommitted changes**, **Branch changes**, a pull
request, a recent commit or bookmark, or any two revisions. Leave the tab open
while you work on the projection:

- **Your edits apply.** While the projection's files have uncommitted edits, the
  tab applies them to both sides and says **Your edits** beside the choice
  (**Show committed** shows the committed version instead). Nothing extracts
  again on its own: when a save changes what the tab shows, it says **Out of
  date** with **Refresh**. A comparator edit compares again at once.
- **Definition** (in the side bar) follows the tab: the definition file and its
  extractor, comparator, renderer and environment, each opening its file or
  reference. **Show Extraction Output** writes the extraction to the
  **Projections** output channel, and an extraction's diagnostics (a side that
  fails, with the extractor's stderr) go to Problems on the definition file.
- **Testing** (VS Code's Testing view) runs the projection's checks and its
  comparator tests, with failures at their lines.

Viewing's **Recent changes** lists the commits that change a projection, and
**Bookmark** keeps a revision pair worth revisiting.

Run `init` again on the same ID to add a part later: `--renderer custom`
scaffolds a custom renderer and `--comparator custom` a custom comparator, and
only those fields of the definition change. `--extractor` starts from a built-in
extractor, so you can write only a renderer for it. `projections init` without
an ID writes only the skill, so an agent can choose the projection itself.
`projections help init` lists every option.

## 2. Ask your agent to build it

`init` prints a prompt to paste into your coding agent, like the one at the top
of this page. Fill in what the projection should show.

Agents that support skills load the skill by its description whenever a task
involves a projection, so later requests ("add the queues to the service map")
need no instructions either. `init` writes it to `.agents/skills`, which GitHub
Copilot, OpenAI Codex, Cursor and Gemini CLI read; Claude Code reads only
`.claude/skills`, so run `projections init --claude` if you use it.
[Agent skills](agent-skills.md) covers other agents and directories. The agent
works through files and the CLI, so it can check its own work:
`projections show` runs the extractor and reports exactly what is wrong with its
output (with `--json`, as a `projections.error` document), `--png FILE` draws it
with its renderer as an image the agent can look at, and `projections check`
verifies the definition, extraction, comparison and renderer in one step.
`projections doctor` reports what the checkout is missing without running
anything, and `projections help authoring` prints the same guide as the skill.

## 3. Write a renderer, if no built-in one fits

```sh
projections init service-map --renderer custom
cd .github/projections/service-map/renderer
npm install
npm run build
```

`@githubnext/projections` isn't on npm yet: the renderer depends on the tarball
attached to your CLI's GitHub release, by URL, and `npm install` downloads it
from there. If you can't download release assets, build it from a Git submodule
instead
([Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections)).
With a development build from a clone
([Early access (from source)](early-access.md)), `init` instead depends on the
tarball `npm run tools -- install` packs there,
`dist/dogfood/githubnext-projections.tgz`, with a `file:` reference; after you
update the clone, run
`npm run tools -- install --only npm --project <the renderer's folder>` to
install the new pack.

A custom renderer is an ordinary front-end package in your repository:
TypeScript, React and Vite, with one dependency for Projections,
[`@githubnext/projections`](../../packages/sdk/README.md). Its kit
(`@githubnext/projections/kit`, with the React shell and components in
`/kit/react`) is the comparison model, step timeline, shell and components the
built-in renderers use; build on it, and the renderer meets the host's checks
from the start. `npm run build` writes the bundle, `dist/index.html` and
`dist/renderer.json`, which viewers load: commit it with the sources.

You write the view, not the page around it: `src/view.tsx` exports `View`, the
renderer's React component, and `vite.config.ts` names it
(`rendererConfig({view: 'src/view.tsx', …})`) and declares what the renderer
supports, such as its comparison modes. The build generates the entry that
mounts `View` in the kit's shell with those capabilities, and writes the same
ones to `dist/renderer.json`.

The scaffold has no stylesheet: its views are composed from the kit's components
(cards, groups, fields), which take every color, size and space from the host's
theme. Keep it that way; the renderer checks fail on hard-coded colors, font
sizes and spacing off the theme's scale.

Build its **diff** first: a comparison opens in it, as one picture of both
revisions with every change marked in place. The scaffold's `src/diff.tsx` draws
one with the kit's diff helpers, and `src/view.tsx` adds side by side and
animated from the same cards; keep that order when you change it.

Develop it against the sample `scenarios.json` (replace them with your own
extractions from `projections show --json`), with the checks every built-in
renderer passes, in the fixtures workbench:

```sh
npm run dev         # in one terminal
npm run workbench   # in another: prints the workbench's URL
```

In VS Code, **Projections: Open Renderer Scenarios…** on the renderer's folder
opens the same workbench.

The same checks run from the command line, and in CI: `npm test` builds the
renderer and runs them on every scenario with Playwright (install its browser
once with `npx playwright install chromium`). The scaffold's
`browser/renderer.spec.ts` sets them up; add your own assertions beside them.

While `npm run dev` runs, the browser workbench loads the renderer from Vite's
development server, so a saved edit updates the frame in place, keeping the
scenario, progress and selection. Without it, and always in VS Code (a webview
can't reach a development server), the workbench uses the built `dist/`.

In VS Code you don't need a watch process: with the projection's tab open in a
trusted workspace, saving one of the renderer's sources starts its
`npm run watch` as a background task (**service-map renderer**, in its own
terminal, with errors in Problems), and the tab reloads the renderer as soon as
the bundle is rebuilt, on your real extractions. The Definition view's
**Renderer** row says whether it is building, built or failed (with the error),
and the watcher stops when you close the projection's tabs. Its **Scenarios**
row opens `scenarios.json` in the workbench. See
[Develop a renderer](../guides/develop-a-renderer.md) for the checks and CI.

## 4. Try it on real history, check and commit it

A comparison is a Before → After pair of refs, so try the projection on
revisions where the system really changed, with your uncommitted projection code
applied to both:

```sh
projections compare v1..v2 -p service-map --trust --definition-revision working-tree
projections check -p service-map --trust
```

Save the pairs worth revisiting in `.projections-bookmarks.json`
([bookmarks](../runner/commands.md)); `projections bookmark run` compares them
all. A custom renderer's `scenarios.json` is for renderer-only data: cases the
history doesn't have yet.

Commit the definition and each part's sources, with a custom renderer's `dist/`.
From then on, `projections compare main...HEAD -p service-map --trust` shows how
any branch reshapes the system, and [adding Projections to CI](ci.md) shows it
for every pull request.
