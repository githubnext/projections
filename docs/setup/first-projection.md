# Build your first projection

Tell your coding agent what system you want to visualize, and it will build a
projection for it—writing an extractor in your project's own toolchain and
pairing it with a renderer that fits. Paste this prompt into your agent,
swapping in a description of what you want to see:

```prompt Copy projection prompt
Create a projection for this repository: run `projections help agents create-projection` and follow what it prints.
It should show: the services in services/*/app.yaml and which services each one calls.
```

Make sure the [CLI](install.md) is on your PATH. Your agent will open the result
in the Projections viewer, a local page it drives in your agent's in-app browser
or a standalone browser while you watch. If you'd rather work right beside your
code inside an editor, see the
[VS Code extension](install.md#the-vs-code-extension). The rest of this page
walks through what the agent does step by step, so you can follow along or build
it yourself.

Every codebase has its own conventions—a home-grown plugin registry, services
wired together in YAML, feature flags with owners—that built-in projections
can't know about ahead of time. A custom projection fills that gap, and a coding
agent can assemble one from a short description. Before writing anything custom,
though, run [explore](quick-start.md#step-2-explore-your-repository) first for
common systems like package dependencies, database schemas, infrastructure, and
Actions workflows: built-in extractors handle those without any code and let you
preview them on real pull requests before deciding what to keep.

A projection has three parts that you can customize independently:

<!-- prettier-ignore -->
| Part | Usually | Built with |
|---|---|---|
| **Extractor** | Custom: it is how Projections learns your codebase | Your project's own toolchain and language. Projections never needs Node for it |
| **Renderer** | Built-in, chosen to fit the extraction's schema | When custom: web development, a TypeScript, Vite and React package using the renderer SDK and kit |
| **Comparator** | Default, perhaps configured | When custom: a comparator file of declarative rules (YAML and CEL), with its tests |

The best starting point is a custom extractor that emits a standard schema
paired with a built-in renderer. Reach for a custom renderer only when none of
the built-ins can draw the view your system needs.

## 1. Scaffold it

```sh
projections init service-map
```

Running `init` generates a working projection you can run right away, and it
never overwrites existing files:

<!-- prettier-ignore -->
| File | What it is |
|---|---|
| `.github/projections/service-map.json` | The definition: title, extractor command and renderer (`graph` unless `--renderer` names another) |
| `.github/projections/service-map/extract.mjs` | A starter extractor in your project's toolchain: Node for `package.json`; Python (`extract.py`) for `pyproject.toml`, `requirements.txt`, `setup.py` or `Pipfile`; Go (`extract.go`) for `go.mod`. `--language` chooses, and `--command` uses a program you already have, in any language |
| `.agents/skills/projections/SKILL.md` | The skill a coding agent loads to build and verify a projection here, updated by every run of `init`. `--claude` adds it for Claude Code; [agent skills](agent-skills.md) says which agents read which directory |

Out of the box, the starter maps your top-level directories so you can verify
the whole loop before writing custom logic:

```sh
projections show -p service-map --trust
projections view show -p service-map --trust --open
```

`projections show` prints a text summary, while `projections view show` opens
the interactive Projections viewer (in your agent's in-app browser, or in a
standalone browser when you pass `--open`). The viewer watches your working
tree, re-extracting and refreshing whenever you save changes to the projection.

If you prefer working inside VS Code, open the repository there, trust the
workspace (because the extractor executes repository code), open the
**Projections** side bar, and click your projection to open it in a tab. The
side bar's **Viewing** section controls what every open projection tab displays:
**Current state** (your working files alone), **Uncommitted changes**, **Branch
changes**, a pull request, a recent commit or bookmark, or any two revisions.
Keep the tab open as you iterate:

- **Your edits apply live.** Whenever the projection's own files have
  uncommitted changes, the tab applies them to both sides and shows **Your
  edits** next to the selection (click **Show committed** to compare against the
  committed version instead). Extractions don't re-run automatically on every
  save—when a save invalidates what's on screen, the tab shows **Out of date**
  with a **Refresh** button, while comparator edits re-run immediately.
- **Definition** in the side bar tracks whichever tab is active, giving you
  direct links to the definition file, extractor, comparator, renderer, and
  environment. **Show Extraction Output** dumps the raw extraction to the
  **Projections** output channel, and extraction failures (including stderr)
  surface in the Problems panel on the definition file.
- **Testing** (VS Code's built-in Testing view) runs the projection's checks and
  comparator tests, mapping failures right to their source lines.

In the Viewing section, **Recent changes** lists commits that modified a
projection, and **Bookmark** saves a revision pair you want to come back to.

You can run `init` again with the same ID whenever you want to add another
piece: `--renderer custom` scaffolds a custom renderer and `--comparator custom`
scaffolds a custom comparator, updating only those fields in the definition.
Passing `--extractor` starts from a built-in extractor so you can focus purely
on writing a custom renderer for it. Running `projections init` with no ID
writes only the agent skill, letting your agent choose the projection ID itself.
Check `projections help init` for the full option list.

## 2. Ask your agent to build it

After scaffolding, `init` prints a prompt you can paste straight into your
coding agent (much like the one at the top of this page)—just fill in what you
want the projection to show.

Agents that support skills automatically load the skill by its description
whenever a task touches a projection, so follow-up requests like "add the queues
to the service map" don't need extra instructions. By default, `init` writes the
skill to `.agents/skills`, which GitHub Copilot, OpenAI Codex, Cursor, and
Gemini CLI all read. Because Claude Code only checks `.claude/skills`, run
`projections init --claude` if you use it; see [agent skills](agent-skills.md)
for other agents and directories.

Because the agent works through regular files and the CLI, it can verify its own
changes at every step. `projections show` runs the extractor and pinpoints any
schema or output errors (pass `--json` to get a structured `projections.error`
document), `--png FILE` renders the projection to an image the agent can
inspect, and `projections check` validates the definition, extraction,
comparison, and renderer in one go. You can also run `projections doctor` to
check what's missing in the checkout without executing anything, or
`projections help authoring` to print the same guide contained in the skill.

## 3. Write a renderer, if no built-in one fits

```sh
projections init service-map --renderer custom
cd .github/projections/service-map/renderer
npm install
npm run build
```

Because `@githubnext/projections` isn't published to npm yet, the scaffolded
renderer points directly to the tarball URL attached to your CLI's GitHub
release, and `npm install` fetches it from there. If your environment can't
download release assets, you can build it from a Git submodule instead—see
[Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections).
When you're running a development build from a clone
([Early access (from source)](early-access.md)), `init` points to the tarball
packed by `npm run tools -- install` at
`dist/dogfood/githubnext-projections.tgz` via a `file:` reference instead; after
pulling updates to the clone, run
`npm run tools -- install --only npm --project <the renderer's folder>` to
refresh the package.

A custom renderer is a standard front-end package inside your repository built
with TypeScript, React, and Vite, with a single Projections dependency:
[`@githubnext/projections`](../../packages/sdk/README.md). Its kit
(`@githubnext/projections/kit`, with the React shell and components under
`/kit/react`) provides the exact comparison model, step timeline, shell, and UI
components that the built-in renderers use. Building on the kit means your
renderer satisfies the host's checks out of the box. Running `npm run build`
outputs `dist/index.html` and `dist/renderer.json`, which viewers load—commit
both alongside your source files.

You only write the view itself, not the surrounding chrome. `src/view.tsx`
exports your React component `View`, and `vite.config.ts` registers it via
`rendererConfig({view: 'src/view.tsx', …})` along with the capabilities your
renderer supports (such as comparison modes). The build generates the entry
point that mounts `View` inside the kit's shell and writes those capabilities to
`dist/renderer.json`.

Notice that the scaffold doesn't include a stylesheet. Views are built from the
kit's components (cards, groups, fields), which pull every color, font size, and
spacing value from the host's theme. Stick to those components—the renderer
checks fail if you hard-code colors, font sizes, or off-scale spacing.

Start by building the **diff** view first, since comparisons open in diff mode
by default as a single picture of both revisions with every change marked in
place. The scaffold's `src/diff.tsx` implements this using the kit's diff
helpers, and `src/view.tsx` builds the side-by-side and animated views from the
same cards; keep that structure as you customize it.

To iterate locally, run the fixtures workbench against `scenarios.json` (swap
the sample data for real extractions captured with `projections show --json`),
which runs the same checks every built-in renderer must pass:

```sh
npm run dev         # in one terminal
npm run workbench   # in another: prints the workbench's URL
```

In VS Code, running **Projections: Open Renderer Scenarios…** on the renderer's
folder opens the same workbench.

Those same checks run headlessly from the command line and in CI via `npm test`,
which builds the renderer and runs Playwright across every scenario (install
Chromium once with `npx playwright install chromium`). The scaffold sets this up
in `browser/renderer.spec.ts`, where you can add your own assertions alongside
the built-in ones.

While `npm run dev` is active, the browser workbench loads your renderer from
Vite's dev server so edits hot-reload in place without losing your active
scenario, timeline position, or selection. Without the dev server—and always in
VS Code, since webviews can't reach a local dev server—the workbench loads the
built `dist/` bundle instead.

In VS Code, you don't even have to start a watcher manually. With your
projection's tab open in a trusted workspace, saving any renderer source file
automatically starts `npm run watch` as a background task (**service-map
renderer**, running in its own terminal with errors routed to Problems) and
reloads the tab on your real extractions as soon as the build finishes. The
**Renderer** row in the Definition view reports whether it's building, built, or
failed (along with the error), and the watcher stops automatically when you
close the projection's tabs. Its **Scenarios** row opens `scenarios.json` in the
workbench. For more on renderer checks and CI, see
[Develop a renderer](../guides/develop-a-renderer.md).

## 4. Try it on real history, check and commit it

Because a comparison pairs a Before and After revision, test your projection
against commits where the system actually changed—applying your uncommitted
projection code to both sides:

```sh
projections compare v1..v2 -p service-map --trust --definition-revision working-tree
projections check -p service-map --trust
```

Save any revision pairs worth revisiting in `.projections-bookmarks.json` (see
[bookmarks](../runner/commands.md)), then run `projections bookmark run` to
compare them all. Reserve a custom renderer's `scenarios.json` for synthetic
renderer-only cases that don't exist in your Git history yet.

Once everything looks good, commit the definition, its source files, and (for a
custom renderer) `dist/`. From then on, running
`projections compare main...HEAD -p service-map --trust` shows how any branch
reshapes your system, and [adding Projections to CI](ci.md) brings that view to
every pull request.
