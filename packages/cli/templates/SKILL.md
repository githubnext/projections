---
name: projections
description: Set up, explore, create, change, debug or review a Projections projection in this repository, or any of its parts - the definition in .github/projections/, its extractor (a program that turns code into an extraction of entities and relationships), its renderer (a sandboxed web page built with the renderer SDK) or its comparator. Use this whenever someone wants to visualize, diagram or map a system in this codebase (services, routes, schemas, plugins, jobs, feature flags, dependencies, events) without showing lines of code, mentions projections, extractions, renderer bundles or the `projections` CLI (explore, adopt, init, show, view, compare, check) or the Projections VS Code extension, wants them in CI, asks to open or show projections (in the viewer, or "the inspector"), or a projection, extractor or renderer here fails or looks wrong.
metadata:
  projections-version: "{{version}}"
---

# Building a custom projection

Projections shows the systems in a codebase (services, routes, schemas, plugin
registries, feature flags, whatever this codebase is unusual about) without
showing lines of code, and shows how a change reshapes them. A **projection**
has three parts, each customizable on its own:

| Part | What it does | When to write your own |
|---|---|---|
| **Extractor** | Examines one revision and writes an **extraction**: JSON entities and relationships | Almost always: it is how Projections learns this codebase |
| **Renderer** | Presents an extraction, or a comparison: first as a diff (both revisions in one picture, changes marked), then side by side or animated | Only when no built-in renderer fits the picture |
| **Comparator** | Relates two extractions: what changed, in which steps | Rarely: the default one matches by ID and groups connected changes |

**Start with what already fits.** Built-in extractors cover common systems
(package dependencies, database schemas, infrastructure, Actions workflows,
the file map): [explore](#start-by-exploring) which apply here and how they do
on this repository's real changes before building anything. When the person
wants something no built-in extractor reads, write a custom extractor that
emits one of the standard schemas (see [Extractor](#extractor)) and pick the
[built-in renderer](#built-in-renderers) that presents it. Write a custom
renderer only when the system needs a picture no built-in renderer draws, and
a comparator only when the order of changes needs explaining.

`projections help authoring` prints this guide for the installed CLI.

**Use the Projections tools when you have them; otherwise the CLI.** In VS
Code's agent the Projections extension offers them (`#projections_compare`
and the others), and any MCP client (GitHub Copilot CLI, Claude Code, Codex)
gets the same tools from `projections mcp`, an MCP server over standard input
and output. They are the commands below as tools that answer in short text:
`list_projections`, `explore`, `sweep`, `compare`, `check`,
`run_comparator_tests` and `describe_part` read; `adopt`, `set_part` (a
definition's extractor, comparator or renderer) and `update_snapshots` write, and preview first. In VS Code the person approves the preview; over
MCP the preview returns a `confirm` token: show the person the preview, and
call again with the token only when they agree. `open_projection`,
`current_view`, `screenshot` and `refresh` are the view tools ([Show the
person](#show-the-person)).

Without the tools you work headless: every step below is a `projections`
command that prints text or JSON, and `projections view show`, `current`,
`screenshot` and `refresh` are the view tools as commands. To look at a
projection yourself, draw it to an image (`--png FILE` on `show`, `compare`
and `check`).

## Show the person

You do the work and show the person the result: a projection is for looking
at, so setting one up or changing it ends with them seeing it and the two of
you discussing it. They look at projections in the **viewer**, a page on this
machine that you drive and they watch: the projection's picture with its
comparison modes, playback and selection, following the working tree (a save
extracts and replays again). When they ask you to "open it in the inspector",
"show me" or "let me see" a projection, they mean this viewer; there is no
separate inspector to start.

- **Show** a projection on a pair or a choice (`branch`, `uncommitted`,
  `last-commit`, `now`, `release`, `bookmark:<id>`), in a mode, with an
  entity selected: `open_projection`, or without the tools `projections view
  show -p <id> --choice branch` (`--before`, `--after`, `--mode`, `--entity`;
  `--trust` when its extractor or custom renderer is repository code). Either starts the viewer
  when none runs and gives its URL.
- **Open the page for them** yourself the first time (the result says when no
  page is open yet): in your own browser if you have one (Codex's built-in
  browser, for example, with `--theme chatgpt` on `projections view show` so it
  matches the app), else in the system browser by adding `--open` to
  `projections view show` (over MCP, run `projections view show --open` with
  the same options in the repository: it finds the MCP server's viewer). Give
  them the bare link only when you can open neither. Later calls change what
  the open page shows, so don't open it again. The link (with its secret
  token) stays the same when the viewer restarts; `--port N` on
  `projections view show` picks its port when it starts one. If
  `current_view` says no page is open although the person has one, it says
  what it saw instead (a page that never connected, a rewritten address, a
  link without its token); give them the URL exactly as printed.
- **In the GitHub Copilot app**, show it in the Projections canvas rather than
  a browser tab: run `projections canvas install` once in the repository (it
  writes `.github/extensions/projections/extension.mjs`), then open the
  `projections` canvas, whose input is `open_projection`'s. It shows the same
  viewer in the app's theme, which a page in a browser tab doesn't get.
- **In Claude Code's Preview pane** (the Claude app), `preview_start` takes
  only a server named in `.claude/launch.json`, not a URL. Add one entry that
  runs the viewer in the foreground on a fixed port, in Claude's colors
  (`--theme claude`; add `--trust` only if the projection runs repository
  code), keeping any other entries:
  `{"version": "0.0.1", "configurations": [{"name": "projections-viewer", "runtimeExecutable": "projections", "runtimeArgs": ["view", "--port", "47470", "--theme", "claude"], "port": 47470, "autoPort": false}]}`
  (any free port; `autoPort: false` keeps Claude from moving it). Start it with
  `preview_start`, then navigate the Preview tab to the full link that
  `projections view show --theme claude …` prints for it, path, token and
  `?theme=` included: the bare port only shows a page asking for its full
  link. The link stays the same when the viewer restarts. Whether
  `.claude/launch.json` is committed or ignored is the repository's choice; ask
  before committing it.
- **In your own app's browser pane** (a custom harness showing the page beside
  you), when the page's default whites and greys don't match the app around it,
  give it the app's colors: `projections view show --theme SEED` (inline JSON
  or a JSON file) puts a theme seed in the link it prints, as `?theme=`; over
  MCP, add `?theme=` with the seed's percent-encoded JSON to the URL yourself.
  A seed is `{"light": {...}, "dark": {...}}` (either mode may be left out);
  each mode has a `background` and optionally `text`, `muted`, `border`,
  `accent`, `focus`, `sans` and `mono` (font names), colors as `#rrggbb` or
  `rgb()`, for example
  `{"light": {"background": "#f7f6f3", "text": "#2f2e2b", "border": "#e4e2dd"}}`.
  The seed is your app's, not the repository's: take the colors from its own
  CSS or source, a screenshot of yourself, or ask the person, keep it in your
  app's own instructions (custom instructions, `AGENTS.md`) and pass it every
  time you open the page. Never in the Copilot app or VS Code, which theme the
  viewer themselves. `current_view` says whether the page took it.
- **Talk it through**: say what they're looking at and what it shows (what
  changed, in what steps, what looks wrong), and show the next projection or
  pair on the same page. `current_view` (`projections view current`) says what
  they see (the projection, its revisions, mode, selection, changes and why an
  extraction failed) and what they selected: call it when they ask about "this
  projection", "this view" or "this one's wrong" rather than asking which one
  they mean. `screenshot` (`projections view screenshot --out FILE`) returns
  what they see as an image (`--page` captures the viewer's page with its
  header, toolbar and summary bar), and `refresh` (`projections view refresh`)
  extracts it again when it says it is out of date. They can switch the page
  to another projection from its title; `current_view` then says so, and shows
  their choice.
- **Side by side**: to show several projections at once, give each its own
  named viewer (`viewer`, or `--viewer <name>` on `projections view show`,
  `current`, `screenshot` and `refresh`): each is its own page and URL, with
  its own state, so open each page for them (in the Copilot app, one
  `projections` canvas per name). Without a name, the calls use the default
  viewer.

In VS Code's agent, `open_projection` shows a projection in a projection tab
instead. People who work in VS Code can also use the Projections extension
themselves: **Projections: Explore Repository** (the sweep as a grid of
pictures, with adopting), a projection's tab (a click in the
Projections side bar: it applies their uncommitted edits and says when a save
makes it out of date, with Refresh) and **Projections: Open Renderer
Scenarios…** (a renderer's scenarios and checks). Outside its agent you can't
drive it, so when they want it, tell them which command to run.

## Start by exploring

Setting Projections up is a loop: find what applies, see it on real changes,
let the person choose, then add them to CI. Nothing is written until they
adopt.

1. **Propose.** The `explore` tool, or `projections explore --list --json`,
   lists the projections whose built-in extractors apply here, each with its
   `basis` (the files that suggested it, such as `prisma/schema.prisma`).
   Nothing runs.
2. **Sweep.** The `sweep` tool, or `projections explore --sweep --json`,
   runs each candidate, and every projection already defined, on the last 20
   merges into this branch (else commits; `--last N`), with the working
   tree's definitions. The tool summarizes it per projection; the command's
   result lists the `changes` (pull request `number`, `title`, `before`,
   `after`), each projection's row (`status` `ready`, or `trust` when it runs
   repository code and needs `--trust`: ask before passing it), and a cell
   per projection and change (`status` `changed`, `unchanged` or `failed`,
   with `changes`, `steps` and `counts` by kind). Ready rows come best first,
   each with its `signal`: `rare` (changed on a quarter of the changes or
   fewer, likely the structural ones), `steady`, `noisy` (on four in five or
   more), `quiet` (never) or `unknown` (fewer than four changes swept).
   `-p ID` limits it.
3. **Report.** Tell the person, per projection, on which pull requests it
   changed and how (`#12: 3 added, 1 removed`). Recommend the `rare` and
   `steady` ones; say that `noisy` ones are likely noise (such as the file map
   on routine commits: it doesn't single out the changes that matter) and
   that `quiet` ones showed nothing here, rather than recommending them; and
   name the pull requests where several projections changed: the best ones to
   look at. When nothing is `rare` or `steady`, say so and offer to build a
   projection of what the repository is about ([Scaffold](#scaffold)).
4. **Ask** which to keep. Never adopt or change CI on your own; a request to
   set projections up for them ("configure a few projections for my codebase")
   is their go-ahead to adopt the few the sweep shows are worth having, so you
   can show them, not to change CI. Say which you adopted and why.
5. **Adopt** what they chose: the `adopt` tool, or `projections adopt
   <id>... --dry-run`, previews the files, then `projections adopt <id>...`
   writes each definition (never over a file) and bookmarks the pull requests
   it changed most on; `projections bookmark run` replays them.
6. **Show** them each adopted projection in the viewer ([Show the
   person](#show-the-person)) on the pull request it says the most about (a
   bookmark adopt wrote, as the choice `bookmark:<id>`; `projections bookmark
   list` lists them), and talk it through. Remove the definitions of any they
   don't want.
7. **Build or tune.** Tune an adopted projection by editing its definition
   (renderer, comparator, extractor options; the `set_part` tool previews the
   diff) and comparing again on a bookmarked change: the `compare` tool, or
   `projections compare <before>..<after> -p <id>`. Build a custom extractor
   ([Scaffold](#scaffold)) only for what no built-in one reads, then sweep it
   too (`projections explore --sweep -p <id> --trust`). Show them the result.
8. **Add to CI** when they are happy, and only once they agree: where the
   Projections step goes depends on their CI, so no command writes it.
   `projections help agents ci` prints the guide. Read the workflows in
   `.github/workflows/`; the default is a step in the job that already
   installs the dependencies and builds (a single build, test and lint
   workflow's job, say), after those steps, so nothing installs twice, with
   that job's checkout changed to `fetch-depth: 0` and
   `persist-credentials: false`. A workflow of its own is the fallback.
   Adapt triggers, branch, runner, matrix and permissions to theirs, explain
   `trust: true` for projections that run repository code, show the diff and
   why it goes there, and write it only when they agree.

## Scaffold

```sh
projections init <id>                      # starter extractor + built-in graph renderer
projections init <id> --renderer dag       # another built-in renderer
projections init <id> --renderer custom    # add a custom renderer (also to an existing projection)
projections init <id> --comparator custom  # add a custom comparator file
projections init <id> --extractor workspace-dependencies --renderer custom
```

The starter extractor uses this repository's toolchain (Node for
`package.json`, Python, or Go; `--language` chooses; `--command` uses an
existing program in any language). The starter extractor, which lists the
top-level directories, is a placeholder: rewrite it in place into the
projection's real extractor rather than adding another projection beside it.
Files go under `.github/projections/`:

| File | What it is |
|---|---|
| `<id>.json` | The definition: title, extractor command, renderer, comparator |
| `<id>/extract.mjs`, `.py` or `.go` | The extractor |
| `<id>/renderer/` | A custom renderer: an npm package (TypeScript, Vite, React) |
| `<id>/<id>.comparator.yaml` | A custom comparator: its comparator file |
| `<id>/<id>.comparator.test.yaml` | The comparator's tests: cases and what each comparison must be |

## The loop

Work in small steps and verify each with the CLI. Never claim a projection
works without running it, and when you hand it over, show it to the person in
the viewer ([Show the person](#show-the-person)) and say which pairs you
compared and what you couldn't verify.

1. **Decide what to show.** Name the entities (things) and relationships
   (directed connections) that explain this system, and the edits that must
   **not** change it (reformatting, moving a file, reordering declarations):
   they decide its IDs. Prefer facts declared in code or configuration over
   runtime behavior, and ask the system's own authority (its compiler or type
   checker, the framework's registry, resolved package metadata, build output)
   before matching source text; mark a fact you had to guess
   `"confidence": "inferred"`.
2. **Write the extractor** and run it through Projections:

   ```sh
   projections show -p <id> --trust          # extracts the working tree, validates, prints a text view
   projections show -p <id> --trust --json   # the saved extraction, to check exact output
   ```

   `--trust` is needed because the extractor is repository code. Errors name
   what failed: extractor exit status and stderr, invalid JSON, or schema
   problems with the path of the offending item; with `--json`, a failure
   is a `projections.error` document (`code`, `message`, `hint`,
   `diagnostics` with JSON paths, `stderr`). Fix and rerun.
3. **Look at it** with its renderer: `projections show -p <id> --trust --png
   /tmp/<id>.png` draws it with its real renderer to an image you can open
   (any path outside the repository works; images never overwrite a file, so
   use a new name each time). To see data the repository doesn't produce yet,
   write the extraction by hand and draw or check it without the extractor:
   `projections show --from made.json -p <id> --png /tmp/made.png`,
   `projections check -p <id> --from made.json` (add `--trust` for a custom
   renderer: it is repository code too).
   Show the person what you see once it draws: the viewer extracts the working
   tree with your uncommitted projection code and replays on a save
   (`refresh` when it says it is out of date). In VS
   Code, the projection's tab (a click in the Projections side bar) does the
   same with their uncommitted edits ("Your edits"), says **Out of date** with
   **Refresh** when a save changes what it shows, and puts a failing side's
   diagnostics, with the extractor's stderr, in Problems; **Uncommitted
   changes** in its Viewing view plays the change.
4. **Compare real history.** A comparison is a Before → After pair of refs
   (branches, tags, commits), and that is how a projection is used, so test
   it on pairs where the system really changed:

   ```sh
   git log --oneline -- <the paths the extractor reads>   # find revisions where it changed
   projections compare v1..v2 -p <id> --trust --definition-revision working-tree
   projections compare main...feature -p <id> --trust --definition-revision working-tree --png /tmp/change.png
   ```

   `--definition-revision working-tree` extracts both revisions with your
   uncommitted projection code; without it, `compare` uses the base
   revision's committed definition, which doesn't have your edits yet. Check
   that each change appears as the right kind (added, removed, modified,
   renamed) in a sensible order, and that a pair that only made the edits
   that must not count shows no changes. Then sweep it across recent changes
   (`projections explore --sweep -p <id> --trust`): a projection that changes
   on nearly every one (`noisy`) holds data that changes for unrelated
   reasons. Save useful pairs in `.projections-bookmarks.json`
   (`{"format": "projections.bookmarks",
   "version": 0, "bookmarks": [{"id": "v1-v2", "title": "v1 → v2",
   "projectionId": "<id>", "before": "v1", "after": "v2"}]}`), which
   `projections bookmark run` compares. Show the person a pair in the viewer
   with `open_projection` (`before`, `after`) or `projections view show -p
   <id> --before v1 --after v2`, which also use your uncommitted projection
   code. In VS Code, the person picks
   **Compare two revisions…** (or a bookmark) in the Viewing view; the tab
   applies their uncommitted projection code to both, as
   `--definition-revision working-tree` does.

5. **Check it end to end** before you say it works (the `check` tool runs
   the same checks, and `render: true` adds the renderer checks):

   ```sh
   projections check -p <id> --trust                       # every check, pass/fail/warn/skip
   projections check -p <id> --trust --png /tmp/<id>.png   # and look at the image
   ```

   `check` validates the definition, extracts the working tree, compares it
   with `HEAD`, checks that a custom renderer's bundle is built and current,
   and runs the renderer checks every renderer must pass in a headless
   browser. It exits nonzero when anything fails; `--json` gives the same
   report as data. `check` compares `HEAD` with the working tree, so with
   nothing changed its comparison checks are skipped; real comparisons come
   from history pairs (step 4), and a custom renderer's `scenarios.json`
   comparisons, which `check` also runs. `projections doctor` says what is missing (a toolchain, an
   unbuilt bundle) without running anything.
6. **Commit** the definition and every part's sources (and a custom
   renderer's built `dist/`).

## Extractor

The extractor reads one JSON request on stdin and writes one extraction on
stdout; stderr is for diagnostics. It runs as argv (no shell) from the
definition's project (the directory holding its `.github/projections`; the
repository root unless it is a nested project), with this repository's own
toolchain: Projections never installs anything. Every path in the definition
(the command, `sources`, `inputs`, the scope) is relative to that project.

```json
{"protocolVersion": 0, "projection": {"id": "...", "definition": {}},
 "repository": {"mode": "in-place", "root": "/abs/examined/revision", "project": "",
                "revision": {"kind": "commit", "ref": "..."}, "checkout": "/abs/where/dependencies/are"},
 "capabilities": {"trusted": true, "network": false}}
```

Read the examined revision under `repository.root`, the project's files in its
`repository.project` directory (empty for the root). **Be correct in place:**
the working tree is extracted in the user's own checkout (`"mode": "in-place"`),
so `root` also holds ignored files (`node_modules`, build output). List the
revision's files the way Git does (`git ls-files --cached --others
--exclude-standard` in `root`) instead of walking the directory, and write only
ignored scratch files there. Other commits run in a workspace or a copy. Read
installed dependencies from `repository.checkout`, read-only. **Never read the
repository relative to the working directory or the extractor's own
location:** that is the definition's revision on both sides of a comparison,
which then shows no change. Declare the extractor's own files in
`extractor.sources`; `projections check` warns when it reads anything else
there.

**If the extractor needs installed dependencies** (it runs `tsc`, a build, the
project's own code), add `.github/projections/environment.json` so a workspace
for another commit installs that commit's own, as CI would:

```json
{"format": "projections.environment", "version": 0,
 "prepare": [{"id": "install", "run": ["npm", "ci", "--ignore-scripts"], "key": ["package-lock.json"]}]}
```

`run` is an argv; `key` lists the lockfiles whose change makes it run again.
Without it, other commits borrow the working tree's dependencies and are
labelled approximate when the lockfiles differ. `projections prepare --trust`
runs the steps in the working tree; `projections doctor` shows what is
prepared.

```json
{"protocolVersion": 0, "schema": "graph/v0",
 "entities": [{"id": "service:payments", "kind": "service", "label": "Payments",
               "data": {"owner": "billing"}, "evidence": [{"kind": "file", "source": "services/payments/app.yaml"}]}],
 "relationships": [{"id": "calls:checkout->payments", "kind": "calls",
                    "from": "service:checkout", "to": "service:payments"}]}
```

`schema` is one of these. Pick the closest; domain detail goes in `data`.

**In Python, don't write this JSON yourself.** Projections puts its
`projections` module on the extractor's `PYTHONPATH` (nothing to install):
`request` is the request (a `dict`; `request.root` is the project's directory
in the examined revision, `request.checkout` where its dependencies are,
`request.inputs` the definition's inputs), and
`result(entities=..., relationships=...)` writes the extraction, items as lists
with an `id` or as dicts keyed by ID, sorted, `graph/v0` unless
`schema="..."`, with optional `metadata`, `volatile` and `missing_inputs`:

```python
from projections import request, result

result(entities={"service:payments": {"kind": "service", "label": "Payments"}},
       relationships=[{"id": "calls:checkout->payments", "kind": "calls",
                       "from": "service:checkout", "to": "service:payments"}])
```

In JavaScript, `result({entities, relationships})` from
`@githubnext/projections/extractor` does the same, when the project has that
package; otherwise, and in other languages, write the JSON above.

{{schemas}}

- Every entity has `id`, `kind`, `label`; every relationship `id`, `kind`,
  `from`, `to`, and both ends must exist. Renderers draw a relationship as an
  arrow from `from` to `to` (`dag` and `graph` place `from` above), so point
  it the way the system flows: caller to callee, a step to the one after it.
  `data` holds JSON values; `evidence` says where a fact came from.
- **IDs must be stable**: the comparator matches items across revisions by
  ID. Use names (`route:GET /orders`), never positions or hashes of content;
  keep changing values in `data`. Declare a rename with `previousIds`.
- **Keep only facts about the item in `data`.** The comparator marks an item
  modified whenever its `data` changes, so data that changes when something
  else does makes it modified on changes that never touched it. Counts and
  lists of things elsewhere ("files importing this module" on an edge, a
  module's line count, its callers) change whenever a file is added anywhere;
  line numbers change whenever code above moves. Leave counts out, or draw
  what they count as relationships. Say where a fact came from in `evidence`
  instead: a file in `source`, a position in
  `"location": {"line": 12, "column": 5}` (not a top-level `line`). The
  default comparator ignores evidence, so moved code isn't a change.
  `projections check` warns about count-, list- and line-like fields a custom
  extractor puts in `data`, unless the definition reads the field (`sizeBy`)
  or declares it `volatile`; a sweep that marks the projection `noisy` is the
  other sign.
- **Deterministic**: the same revision must give the same extraction. Sort
  output (`result()` does); never read the clock, the network, random numbers or the
  environment. `projections check` reruns it and warns, naming what varied.
  Declare `execution.determinism` honestly: `pure` (only the files),
  `environmental` (the default: also the toolchain and dependencies) or
  `observed` (timings and other varying data).
  When some `data` genuinely varies between runs (test durations, sample
  counts, benchmark means), declare it beside `metadata` instead of dropping
  it: `"volatile": [{"kinds": ["test"], "path": "/data/durationMs",
  "tolerance": {"absolute": 50, "relative": 0.2}}]` (pointers under
  `/data/`, `*` for any key or index; a tolerance is within when any bound
  holds, and `{"spread": "/data/stdevMs", "factor": 2}` follows a recorded
  spread). Comparisons then list variation within tolerance as `unchanged`
  with `varied`, in no step, and the rerun counts it as reproducible. CI's
  run is the official result.
- A value a language model writes (a summary of a class or package) is a
  **generated value**: declare it `{"kinds": ["class"], "path":
  "/data/summary", "generated": true, "basis": "/data/summaryBasis"}` and
  record beside it a basis of named parts, each hashed: what the model read
  (`input`, narrowly: the class, not its file), the prompt (`prompt`) and, if
  a model upgrade should count, the pinned model ID (`model`, verbatim). Never
  seeds, timestamps or credentials. Equal bases make a rewording unchanged;
  a moved part makes the item modified, saying which part. In JavaScript,
  `basis()` and `generations()` from `@githubnext/projections/extractor` hash
  the basis and reuse the generation store's text for an equal one, so reruns
  are identical. Such an extractor needs `execution.network`, its credential
  variables in `execution.environment`, `--trust`, and `environmental`
  determinism. When you describe a comparison, say a generated value is
  generated, not an extracted fact.
- Fail loudly (nonzero exit, a message on stderr). Never print an empty
  extraction to hide an error.
- Limits: 30 s by default (`execution.timeoutMs`, up to 300000), 8 MiB of
  stdout, 10000 entities. Declare what it reads in `execution.scope`, so other
  revisions check out only that (`--workspace sparse`): seconds, not minutes.

To debug it directly, pipe a request in:
`echo '{"protocolVersion":0,"projection":{"id":"x","definition":{}},"repository":{"root":"."},"capabilities":{"trusted":true,"network":false}}' | node .github/projections/<id>/extract.mjs`
(for Python, `PYTHONPATH="$(projections __python-path)" python3 .github/projections/<id>/extract.py`; in PowerShell,
set `$env:PYTHONPATH = projections __python-path` and run `python`). In a
definition, write `python3`: the runner runs a bare `python3` or `python` with
the machine's Python 3, including `python` or `py -3` on Windows.

## Built-in renderers

Set `"renderer"` in the definition (or `projections init <id> --renderer
NAME`) to one of the renderers this CLI includes:

{{renderers}}

Each presents the schemas the extractors above pair it with;
`projections extractor list` shows every built-in extractor's schema and
renderer, and `projections show -p <id> --png FILE` shows how one draws your
extraction. A definition naming an unknown renderer shows the host's table
view, with a notice.

## Custom renderer

A custom renderer is web development: an npm package in `<id>/renderer/`
written in TypeScript and React with one dependency, `@githubnext/projections`.
Build on the renderer kit (the shell, comparison model, step timeline, layout
and status components the built-in renderers use): `@githubnext/projections/kit`
is its framework-free half, `/kit/react` its React components and hooks, and
`/kit/react.css` their styles. Use it rather than your own markup and CSS: the
kit already meets the checks the host holds every renderer to. The starter has
no stylesheet: compose views from the kit's components (`ContentView`, `Group`,
`CardGrid`, `EntityCard`, `Fields`, `Stack`, `Inline`, `Text`) and their props,
and for an inline style they don't cover use `token` (`token.space(2)`). For
items with comparable properties (a row per item, a column per property), use
the kit's `DataTable` rather than hand-built table markup: sortable headings
held in the host's controls (`tableSortControls`, `useTableProps`), a frozen
first column, value-change pills and one line per boundary, as the checks
expect.
`ContentView` sets its cards and tables in from the frame by the same stage
padding on all four sides, as every host expects; don't pad or margin around it. The
checks fail on any color, font size, spacing or radius that isn't a theme
token, and name the token to use. `/renderer` is the host protocol client
underneath it (`/renderer/react` its React hooks), `/vite` the build,
`/testing` the checks and `/schemas` the document types. It needs Node and npm,
like any front end. (npm 11 may warn that esbuild's install script isn't covered by
`allowScripts`; the build doesn't need it.) `@githubnext/projections` isn't on
npm yet: `package.json` depends on the tarball attached to the CLI's GitHub
release, by URL, at `projections --version`; keep the two at one version
(`projections doctor` warns when they differ). If `npm install` can't download
it, the person can build it from a Git submodule
([Install @githubnext/projections](https://github.com/githubnext/projections/blob/main/docs/guides/develop-a-renderer.md#install-githubnextprojections));
never replace it with a `file:` link to a package directory.

```sh
cd .github/projections/<id>/renderer
npm install
npm run build        # writes dist/index.html and dist/renderer.json; commit dist/
npx playwright install chromium   # once
npm test             # builds, then runs the renderer checks on every scenario; keep them passing
npm run workbench    # for the person: the scenarios and checks in a browser
npm run dev          # beside it: hot updates in the workbench while it runs
```

`scenarios.json` is renderer-only data: extractions (or before/after pairs)
for developing and checking the renderer, including cases the repository's
history doesn't have yet (an empty extraction, a very large one, every kind of
change). Start them from real output (`projections show v1 -p <id> --trust
--json`), and test the projection itself against real history pairs, not
scenarios. `npm test` and `projections check` run the checks the host holds
every renderer to. Show the person the renderer in the viewer, on real
extractions or on a scenario (`open_projection` with `scenario`, or
`projections view show -p <id> --scenario <id>`): the viewer builds a custom
renderer while it shows it. The workbench (`npm run workbench`, or
**Projections: Open Renderer Scenarios…** on the package in VS Code) updates
on every edit and runs the same checks (**Run checks**, ⌘E / Ctrl+E). In VS
Code, the projection's tab shows the renderer with real extractions; with the
tab open in a trusted workspace, saving a renderer source runs the package's
`npm run watch` as a background task (errors in Problems, its state on the
Definition view's Renderer row) and the tab reloads the renderer, so the
person needs no watch process of their own.

**Build diff mode first.** A comparison opens in diff when the renderer has
it, and it is the view people review changes in: one static picture of the
union of both revisions, in the renderer's own form, with everything added,
removed or changed marked where it is. Get it right, then add side by side and
animated from the same view if time allows. The starter does this:
`src/diff.tsx` is its diff, `src/view.tsx` its other modes, and
`vite.config.ts` declares `comparisonModes: ['diff', 'side-by-side',
'animated', 'swipe']` (diff first). In diff mode (`props.diff`):

- `diffModel(model)` lists every entity of either revision once (`entity`
  is After's version, or Before's for a removed one; `fields` says what
  changed) and every relationship (one rewired between other entities is two
  parts, its old one removed and its new one added). Lay the union out once,
  close to After's layout, with nothing overlapping.
- Spread `changeMark(change)` on each element that has `data-entity-id`, with
  the kit's `pk-region` class (HTML) or `pk-diff-shape` (SVG): the kit fills
  and edges it in the change's hue, and strikes a removed item's
  `pk-diff-text` through. Show changed values inline with `ValueChange`
  (old struck through, then new).
- Draw no summary line in any mode: the host's summary bar, along the bottom
  of the view, counts each kind with its changes. Name the kinds in your
  domain's words with `nouns` in `src/view.tsx`'s `options` (`false` leaves
  out structure, such as containment drawn as boundaries), and state what
  counts can't say (`2 breaking changes`, `1 newly enforced`) as `facts`
  computed from the document, each with the IDs it filters to.
- Say every change in words too (`ChangeFooter`, `sr-only` text), and let the
  marks follow `emphasis(row)`, so highlighting off draws the union plain.
- `projections check` warns when a renderer has no diff mode, and its
  `diff-changes`, `diff-neutral`, `diff-clipping`, `stable-layout` and
  `status-text` checks hold the diff to these rules.

The renderer has no entry of its own: `vite.config.ts`
(`rendererConfig({view: 'src/view.tsx', …})`) declares its capabilities once,
and the build generates the entry that mounts `src/view.tsx`'s `View` with
them in the kit's shell, along with that module's `options` (`nouns`, `facts`,
`controls`). The shell gives `View` `RendererProps`:
`model` (rows pairing each entity across the comparison), `diff`,
`schedule`, `progress`, `emphasis(row)`, `selectedId`, `onSelect`,
`comparing`. Rules the checks enforce in every mode:

- Animated: time every change by its own step, so nothing moves while the host holds
  between steps. `const timeline = createStagedTimeline(model, schedule)`
  gives, for an entity row's `id`: `presence(id, progress)` (opacity 0-1),
  `local(id, progress)` (progress through its own step; pass it to
  `current(row, local)` for the version to draw) and `rowPresence(id,
  progress)` (`{size, opacity}` for list slots). These take entity IDs only.
  For relationships, `timeline.at(progress)` gives `{from, to, mix}`: the two
  stages the frame lies between; `timeline.relationships(timeline.stages[k])`
  lists those present in stage `k` as `{row, from, to}` (entity row IDs).
  Fade one present in only one of the two stages by `mix`. The starter's
  `src/view.tsx` does exactly this for each card's outgoing relationships.
- Look at the animation frame by frame, not at its endpoints: draw frames
  across each step's window (`projections compare v1..v2 -p <id> --trust
  --definition-revision working-tree --progress 0.42 --png /tmp/f42.png`,
  0.02 apart, finer around a bad frame), forward and backward. Nothing
  collides, flies in from an unrelated place or changes size or framing
  mid-step, and a relationship comes and goes with its cards.
- At progress 0 and 1, and whenever highlighting is 0, nothing is emphasized:
  both endpoints look like plain extractions. Use `emphasis(row)`.
- State change status in words (`ChangeFooter`, `ChangeStatus`) in space that
  is always reserved, never by color alone.
- Put `data-entity-id` on every selectable element; wrap identifiers (IDs,
  paths, kinds) in `Identifier` so they use the monospace font.
- Draw relationships and put the relationship's ID in `data-entity-id` on
  what draws each one, as for entities (the starter does, in each card), so
  they can be selected and the checks see them (the `relationships` check
  fails when none is marked). A renderer that deliberately draws none, or
  shows them only as nesting, declares `capabilities: {drawsRelationships:
  false}` in `vite.config.ts`'s `rendererConfig`.
- Put `data-entity-id` on the element that draws the item's visible edge (its
  **unit**, or **item**; mark it `data-projections-unit` where entity elements
  nest). Hover, keyboard focus and selection rings are the renderer SDK's,
  drawn as styling on that element: an outline inside an HTML unit's border,
  or, in SVG, the stroke of the shape you mark `data-projections-edge` (the
  card's surface, a circle; `data-projections-edge="line"` for a
  relationship's path, which is highlighted as the line itself, never
  outlined; `data-projections-edge="fill"` for an arrowhead, and
  `data-projections-ring-with="<id>"` on a piece drawn in another layer). Draw
  the edge as a border (not an outside box-shadow), keep positioned children
  from painting over it, draw no ring, outline or selection border of your
  own, and tint parts inside a unit rather than outlining them. The `rings`
  check holds every unit to this and names the element to mark when it fails.
- Draw no title or counts: the host shows them, so content starts at the top
  of the frame (mark a content region with `data-projections-content`).
- Accent and focus colors are only for focus and selection; change colors only
  for change status. No horizontal scrolling at 390 px. No network: the
  sandbox blocks it, so bundle every asset.
- Never nest change colors: only the innermost changed elements are colored. A
  modified card, row, table or boundary that shows changes inside it (added and
  removed pills, an old and a new value, changed cards) stays neutral, with at
  most a neutral edge and its status words muted; never an amber fill or edge
  around green and red. The kit's components do this when changed parts carry
  `data-change`; mark anything drawn over an item instead of inside it with
  `pk-holds-changes`. The `nested-accents` check fails any change or accent
  color drawn inside another.

## Comparator

Leave `comparator` out of the definition unless the default comparison
misses what a change means. Configure the default one first for order:
`{"comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}}}`.
Write a custom one when the domain knows something about change that the
extraction can't say alone, because only the comparator sees both revisions:

- **Verdicts:** summaries and metadata such as "breaking" or "scope
  broadened" (keep the baseline's changes; add `summary` and `metadata`).
- **Identity:** a removed and an added item that are the same thing (moved
  or renamed): replace the two changes with one `declared` change, or use
  `split` and `merge`.
- **Order:** reorder `baseline.steps` so the story is told in the right
  sequence.

Every renderer and view then shows it, with no renderer change. A custom
comparator is a **comparator file**, `<name>.comparator.yaml`: YAML declarations
and CEL expressions (its comparator rules) over the default comparator, run sandboxed (no files, network, clock or
randomness). `identity` passes pair items the default matching left
unmatched (by a `key`, or the IDs items `claims`); `classify` writes a
`summary` and an `annotation` per change; `steps` ranks steps (`rank`) or
gathers changes into new ones (`add`); `metadata` adds values. Expressions
see `before`, `after`, `options` and `baseline`; `change.varied` lists the
volatile values that differ (`{path, within, generated, because}`, `[]` when none;
`generated.only(change, ['model'])` finds model-only regenerations), and changes
that only varied within tolerance skip `classify` and steps; `variables` name values and
`functions` name typed expressions. Comparator files are checked when they load, with
each problem's line and column (`projections check -p <id>`). The Engine
still rejects a comparison that hides or invents a change. This comparator
file tells steps that touch the listed IDs first:

```yaml
format: projections.comparator
version: 0
variables:
  - name: first
    expression: 'has(options.first) ? options.first : []'
steps:
  rank: 'change.id in variables.first ? 0 : null'
```

Every item has `data` (`{}` when absent), and `classify` binds `item` (the
after item, or the before one when removed). Chained ternaries are a smell:
the check warns at three, and `match(kind, {'a': x, …}, default)` (a table),
`collect({cond: 'tag', …})` (what holds), `cond({c1: v1, …}, default)`
(ordered conditions), `template('{name} moved', {'name': n})` (text) or a
named function read better.

You MUST write tests beside the comparator file: `<id>.comparator.test.yaml` for
`<id>.comparator.yaml` (`projections init <id> --comparator custom` scaffolds
both). Each case gives `before` and `after` (fixture files relative to the
test file, `{extraction: {...}}` inline, or `{revision: HEAD}`) and states the
output you intend, before you write the comparator that produces it:

```yaml
format: projections.comparator-tests
version: 0
cases:
  - name: listed changes come first
    before: fixtures/before.json
    after: fixtures/after.json
    options: {first: ['service:billing']}
    expect:
      order: ['service:billing', 'service:web']
      changes:
        - {item: 'service:billing', status: modified, summary: 'Billing now retries.'}
      metadata: {verdict: breaking}
  - name: rejects bad options
    before: fixtures/before.json
    after: fixtures/after.json
    options: {first: 1}
    expect: {error: 'invalid options'}
```

Prefer partial expectations that say what the comparator is for: `order`,
`steps` (every step, with the `kind`, `summary` and `changes` you list),
`changes` (each selects one change by `item` or `id`), `count`, a subset of
`metadata`, or `error`. Add `snapshot: snapshots/<name>.json` for regression
over the whole comparison; `projections check -p <id> --update` writes it.
Run `projections check -p <id> --no-render` until the step "Comparator
tests" passes; a failure names the expectation, its line and column, and a
diff. Add `--coverage` to see the functions, expressions and decision outcomes
no case runs, by line, and add cases for the ones that matter. Never edit a snapshot or an expectation just to make a failure go away
without understanding it. In VS Code, the person sees and runs the same cases
in the Testing view.

Logic that needs a compiler or a resolver (type assignability, resolved
versions) belongs in the extractor, as facts in `data`; the comparator compares
them. Reference:
{{docs}}docs/design/declarative-comparators.md

Examples of each kind:
{{docs}}docs/guides/comparators.md

## Definition

```json
{
  "id": "service-map",
  "title": "Service map",
  "extractor": {"command": ["node", ".github/projections/service-map/extract.mjs"],
                "sources": [".github/projections/service-map/extract.mjs"]},
  "renderer": "graph"
}
```

A custom renderer is `{"bundle": ".github/projections/<id>/renderer/dist",
"sources": [...]}`; a custom comparator is the comparator file's path,
`".github/projections/<id>/<id>.comparator.yaml"`, or `{"file": ..., "options":
{...}}` with options (an object without `file` is the default comparator).
Comparator files must end in `.comparator.yaml`.
`sources` list the files whose content belongs to each part, so a comparison
can tell you when a revision changed it. Optional: `execution` (`timeoutMs`,
`environment` allowlist, `determinism`, `scope`), `inputs`, `correspondence`
(renames), `presentation` (initial viewer settings). `environment.json` in the
definition directory is the environment file, never a definition.

## When something fails

- `requires --trust`: the projection runs repository code; add `--trust`.
- Extractor errors include its exit status and stderr; run it directly as
  above.
- `Renderer bundle ... must contain index.html`: build the renderer
  (`npm run build` in its package).
- `projections validate FILE` checks a saved extraction or comparison.
- `projections doctor` lists what this checkout is missing, running nothing.
