# Commands

```sh
projections explore                          # propose projections (VS Code's Explore view sweeps them)
projections explore --list --json            # the candidates, running nothing
projections explore --sweep --last 30        # each candidate on the last 30 merges, in the terminal
projections adopt prisma-schema --dry-run    # the definition and bookmarks it would write
projections help agents ci                   # how your coding agent adds the GitHub Action to your CI

projections init service-map                 # starter extractor, built-in graph renderer, agent skill
projections init service-map --renderer custom --comparator js   # add custom parts
projections init files --extractor repository-map --renderer graph
projections init services --command '["python3","collect.py"]'
projections check -p service-map --trust     # verify it end to end, renderer checks included
projections doctor                           # what this checkout needs, running nothing
projections prepare --trust                  # run the environment's prepare steps in the working tree
projections prepare --revision main --trust  # prepare the workspace for a commit
projections workspace list                   # the workspaces Projections keeps
projections workspace clean
projections help authoring                   # the guide to building a projection
projections help agents explore              # a prompt for a coding agent to follow

projections show -p files                    # the working tree, as accessible text
projections show main -p files --json        # one commit's saved extraction document
projections show -p files --png files.png    # also draw it with its renderer
projections show --all main                  # every projection main defines
projections show --from saved.json --png saved.png
projections show --from hand-made.json -p files --png made.png   # raw extractor output
projections list                             # definitions and execution policy, running nothing
projections serve --stdio --trust            # the Inspector's backend, which the VS Code extension starts
projections mcp                              # the agent tools, for a coding agent (an MCP server)

projections compare main -p files            # main compared with the working tree
projections compare main..HEAD -p files      # two revisions
projections compare main...feature -p files  # from the merge base, like a pull request
projections compare main..HEAD --all --json  # every projection, as a batch document
projections compare main..HEAD -p files --png change.png --mode side-by-side --theme dark --scale 2
projections bookmark list
projections bookmark run                     # every saved comparison
projections pr https://github.com/acme/service/pull/42

projections extractor list
projections extractor view repository-map
projections show HEAD -p services --trust --output /tmp/services.extraction.json
projections validate /tmp/services.extraction.json
```

- `explore`: Propose the projections whose built-in extractors apply here, from
  the files Git tracks (each extractor declares `detects` patterns), with the
  files that suggested each. Writes nothing. Prints them and how to try them in
  VS Code (**Projections: Explore Repository**, whose Explore view sweeps them);
  `--list` prints only them. `--sweep` runs each candidate and every defined
  projection on the last `--last N` (default 20, at most 100) first-parent
  merges into the branch when merges are at least half of its recent
  first-parent commits, else on its first-parent commits (a repository that
  squashes or rebases), extracting every revision with the working tree's
  definition, at most `--concurrency N` (default 2) extractors at once, and
  prints how much each changed on each; `-p ID` limits it, `--json` prints the
  `projections.sweep` document. Projections that run repository code are skipped
  without `--trust`.
- `adopt ID...`: Write each explored candidate's definition
  (`.github/projections/ID.json`, or `.projections/` when the repository uses
  it; never over a file) and add the `--bookmarks N` (default 3) changes it
  changed most on in a sweep of the last `--last N` to
  `.projections-bookmarks.json`. `--dry-run` prints the files instead.
- `init [ID]`: Scaffold a projection, or add parts to an existing one, and write
  or update the agent skill (`.agents/skills/projections/SKILL.md`, or the
  skills directory that already holds it or `--skills-dir DIR`; `--claude` adds
  it to `.claude/skills` for Claude Code; see
  [agent skills](../setup/agent-skills.md)). A new projection gets a starter
  extractor in the project's toolchain (Node when the root has `package.json`;
  Python for `pyproject.toml`, `requirements.txt`, `setup.py` or `Pipfile`; Go
  for `go.mod`; otherwise `--language node|python|go` is required) and the
  built-in `graph` renderer. `--extractor ID` and `--command ARGV_JSON` use a
  built-in extractor or an existing program instead; `--renderer NAME` picks a
  built-in renderer, and `--renderer custom` scaffolds a renderer package
  (TypeScript, Vite, React, the renderer SDK and kit) in `ID/renderer/`;
  `--comparator custom` scaffolds a starter comparator file,
  `ID/ID.comparator.yaml`, and its tests. For an existing projection, only the
  named parts are added and only their definition fields change. Without `ID`,
  writes only the skill. Never overwrites a projection file and runs nothing. A
  custom renderer depends on `@githubnext/projections`, which isn't on npm yet,
  by the URL of the tarball attached to this CLI's GitHub release;
  `PROJECTIONS_RENDERER_PACKAGES=DIR` instead installs it from an `npm pack`
  tarball in `DIR` (such as one built from a Git submodule), and a development
  build from a clone (`npm run tools -- install`) from the clone's packed
  `dist/dogfood/githubnext-projections.tgz` with a `file:` reference.
- `check [-p ID]...`: Verify projections end to end (every one the working tree
  defines, by default): the definition is valid, the working tree extracts, a
  rerun of it gives the same extraction, up to the fields it declares `volatile`
  and their tolerances (the Engine's `vary` judges; a difference beyond them
  warns, naming the items and fields that varied; `--strict-determinism` makes
  it fail, and an `observed` extraction isn't rerun; generated values reworded
  from an equal basis are expected variation, with a note to reuse them through
  the [generation store](caches.md#generation-store), and a `pure` definition
  that produces generated values warns), a declared scope is verified by
  extracting only the scope (see [Scopes](execution.md#scopes)), a custom
  extractor run from a copy holding only the definition's own files gives the
  same extraction (otherwise it warns: the extractor reads files beside it,
  which a comparison takes from the definition's revision on both sides; see
  [Definitions and execution](execution.md#exact-source-and-explicit-execution)),
  `HEAD` compares with it (the working tree's definition applied to both), a
  custom comparator passes the tests beside its comparator file
  (`*.comparator.test.yaml`; `--update` writes their snapshots and `--coverage`
  reports which of the comparator file's functions, expressions and branches
  they run, see [Comparator tests](stdio-backend.md#comparator-tests)), a custom
  renderer's bundle is built and newer than its sources, and, in a headless
  browser, the renderer passes the checks every renderer is held to, on the
  working tree and the comparison (each presented as the definition's
  `presentation` says) and a custom renderer package's own `scenarios.json`.
  Each check is `pass`, `fail`, `warn` or `skip`, in words; the exit status is
  nonzero when any fails. `--png FILE` also draws the (one) projection's working
  tree (an existing file fails that step only); `--from FILE` checks raw
  extractor output for the one projection instead of extracting, skipping the
  comparison; `--no-render` skips the browser; `--parity REV` also compares a
  local extraction of a commit with CI's (see
  [CI artifacts](caches.md#ci-artifacts-as-a-source)); `--json` prints the
  `projections.check` document.
- `doctor [-p ID]...`: What this checkout needs to run its projections: the Git
  checkout and its commits, valid definitions, the environment (what is
  declared, what the working tree has prepared, stale steps, missing tools) and
  the workspace strategy and why, each extractor's program and files, custom
  renderer bundles (and running development servers), comparator files, the
  agent skill and a browser for images and checks. Runs no repository code and
  changes nothing; exits nonzero when something is missing. `--json` prints the
  `projections.doctor` document.
- `prepare`: Run the environment file's prepare steps, in the working tree by
  default or, with `--revision REV`, in the workspace for that commit; each step
  runs only when its key files changed since it last ran there (`--force`
  reruns; `--step ID` selects). Needs `--trust`. `--json` prints the
  `projections.prepare` document. See
  [Environments and workspaces](environments.md#environments-and-workspaces).
- `workspace list`, `workspace clean`: The workspaces Projections keeps for
  toolchain extractions of other commits, and removing those not in use.
- `show [REVISION]`: Run the projection's extractor on one revision (the working
  tree by default) and present the extraction. `-p ID` names the projection; it
  can be omitted when the revision defines exactly one. `--all` shows every
  defined projection. `--definition-revision REV` applies another revision's
  definition, so extractions of several revisions can be compared. `--from FILE`
  presents a saved extraction or comparison instead of extracting; with `-p ID`,
  `FILE` is raw extractor output (what an extractor writes to stdout, possibly
  hand-made), which the working tree's definition normalizes, digests and
  validates without running anything. `--png FILE` also draws it; see
  [Images](#images).
- `compare <BASE>[..<HEAD>]`: Extract both revisions with one definition, run
  the comparator and present the comparison. One revision compares with the
  working tree; `<BASE>...<HEAD>` starts at their merge base; an empty side
  means `HEAD`, as in Git. `-p ID` names the projection; `--all` compares every
  projection either revision defines. `--definition base|head` chooses which
  revision's definition and component code apply to both;
  `--definition-revision REV` applies another revision's instead, for example
  `working-tree` to try uncommitted projection code on real history.
  `--before-extraction FILE --after-extraction FILE [--comparator FILE]`
  compares saved extractions without running extractors. `--png FILE` also draws
  it.
- `list`: The validated definitions at `--revision` (working tree by default)
  with `requiresTrust` and `rendererRequiresTrust`, without running anything.
  `defaults` says when the working tree defines none and the built-in defaults
  (`workspace-dependencies` and `repository-map`) apply. Once a repository
  defines its own projections the defaults are no longer listed, but they stay
  addressable by ID (`-p repository-map`) until one of its definitions uses that
  ID. A definition file that isn't valid doesn't hide the others: `invalid`
  lists each with its `path` and `diagnostics` (each with the offending field's
  `pointer` and `location`, `{path, line, column}`), the text names it as
  `id: invalid: path:line:column: message`, and the command exits nonzero.
- `serve --stdio`: The Inspector's backend for an editor extension that starts
  the CLI (the VS Code extension does), as JSON-RPC over standard input and
  output, with no port or listener: the working tree live, or with
  `--document FILE` a saved extraction, comparison or pull request review
  (running nothing), or with `--fixtures` scenario fixtures for developing
  renderers and comparators; see [Stdio backend](stdio-backend.md). `--trust`
  lets it run repository code.
- `mcp`: Projections' [agent tools](agent-tools.md) for a coding agent (GitHub
  Copilot CLI, Claude Code, any MCP client): a Model Context Protocol server
  over standard input and output. `--trust` lets the tools run repository code
  and write outside an explore session.
- `bookmark list`, `bookmark run [ID]...`: Saved comparisons in
  `.projections-bookmarks.json`: list them, or compare them (all by default) as
  a batch.
- `pr NUMBER|URL`: Untrusted review of an existing GitHub pull request; see
  [Untrusted pull request review](pull-requests.md).
- `extractor list`, `extractor view ID`: Built-in extractors: their inputs,
  schema, renderer, execution policy and definition template.
- `validate FILE|-`: Validate a saved extraction, comparison or scenarios
  document (`-` reads standard input). `--json` prints the result, `--quiet`
  nothing. A comparison made by a custom comparator is reproduced only with
  `--comparator FILE`; otherwise the result says it wasn't
  (`"reproduced": false`).
- `help [COMMAND|TOPIC]`: Help for a command, or `help authoring`: the guide to
  building a projection (the agent skill's text), or `help agents [NAME]`: the
  prompts a coding agent follows (`explore`, `create-projection`, `ci`,
  `install`), bundled with the CLI, the same as `docs/agents/*.md`.
- `licenses`: The license and third-party notices for everything the executable
  includes.

Every command takes `-C DIR` (`--directory`): any directory inside a Git
checkout, whose top level is used, so commands also work from subdirectories
without it. Commands that run extractors accept `--trust` and the container
options below. A repository needs at least one commit, because every working
tree records the commit it is based on.

Commands that extract also take `--no-cache` (skip the
[extraction cache](caches.md#extraction-cache)), `--ci` and `--artifact DIR`
(reuse [CI artifacts](caches.md#ci-artifacts-as-a-source)), `--in-place`
(extract a commit that is the checkout's `HEAD` in place despite untracked
files, as in CI) and `--workspace STRATEGY` (see
[Environments and workspaces](environments.md#environments-and-workspaces)) and
`--regenerate` (generate [generated values](caches.md#generation-store) again
rather than reuse the generation store's); `serve --stdio` and `mcp` take the
same options.

## Errors

A failure prints its message to stderr with what to do next, and the exit status
is 1 (2 for a malformed command line). Extractor failures include the
extractor's exit status and stderr; an invalid extraction lists each problem
with its code and the JSON pointer of the offending item. With `--json` (or
`--output`), a failure also prints a `projections.error` document to stdout, so
tools and agents can act on it:

```json
{
  "format": "projections.error",
  "version": 0,
  "error": {
    "code": "INVALID_EXTRACTION",
    "message": "...",
    "hint": "Fix what each diagnostic names (path is a JSON pointer into the extraction), then run again.",
    "diagnostics": [
      {
        "severity": "error",
        "code": "UNKNOWN_ENDPOINT",
        "path": "/relationships/0/to",
        "message": "..."
      }
    ]
  }
}
```

`code` is `TRUST_REQUIRED`, `EXTRACTOR_FAILED` (with `stderr`),
`INVALID_EXTRACTION`, `INVALID_INPUT` or `ERROR`. A failed process is named by
its file name (a built-in by its extractor ID), never by the absolute path it
ran from. The Inspector and the VS Code extension show the extractor's own error
once: the stderr line that says what went wrong (an `Extractor <id>:` report,
the first `Error:`-style line, a Python traceback's last line or a Rust panic's
message), never a source location or excerpt; the whole stderr is behind **Raw
output**.

## Output

`show` and `compare` print an accessible plain-text rendering by default: no
color, layout or symbols that need sight to interpret. `show` lists entities
grouped by kind, each followed by its outgoing relationships. `compare` names
both revisions, the comparator and definition digest, any definition notices,
counts by status, then each step in order with its changes (`Added`, `Removed`,
`Changed`, `Renamed`, `Split`, `Merged`) and their summaries.

`--json` prints the saved extraction (`projections.extraction` version 0),
comparison (`projections.comparison` version 0) or, with `--all` or
`bookmark run`, batch (`projections.batch` version 0) document instead.
`--output FILE` writes the same JSON to a new file (never overwriting),
pretty-printed with two-space indentation (compact only when just that fits the
size limits below), and prints nothing. Comparison documents carry definition
notices in `notices` (omitted when there are none), and batch items carry them
in `notices` too. In JSON modes the notices are also printed to stderr as
`projections: note: ...`.

When a declared input (a file, folder or glob a built-in's `inputs` name)
doesn't exist at a revision, the built-in extracts that revision as empty and
lists the input in the extraction's `missingInputs`, rather than failing.
`compare` then shows its contents as added (missing before) or removed (missing
after) and adds a notice naming the input and the revision. `show` prints a
note; when the extraction is empty, it says the projection has nothing to show
at that revision. `check` still fails its extraction step, since at the checked
revision a missing input is a misconfiguration. A file that exists but doesn't
parse is an error as before.

## Images

`--png FILE` on `show` and `compare` also writes a PNG of what the Inspector
shows, for READMEs, pull request comments and other places that can show an
image but not run a renderer. The text (or JSON) is printed as usual:

```sh
projections show -p files --png files.png                          # the working tree
projections show v1.2.0 -p files --theme dark --png files.png      # one revision
projections compare main...feature -p files --png change.png       # the renderer's default mode: its diff, when it has one
projections compare main..HEAD -p files --progress 0.5 --png mid.png
projections compare main..HEAD -p files --mode side-by-side --png pair.png
projections compare main..HEAD -p files --mode animated --png head.png # animated, at the head (progress 1)
projections show --from saved.comparison.json --png saved.png
projections show --from saved.comparison.json --side after --png head.png
projections show -p files --frame none --png bare.png             # the renderer's content alone
```

By default the image is one rounded card with a hairline border: the renderer's
content on top, then its legend and the summary bar, each ruled off by a
hairline. Outside the rounded corners the PNG is transparent, with a pixel of
room around the card, so it sits on any background, GitHub's light and dark
READMEs included. Its surface, border and rules follow `--theme`; for a README,
draw one image per theme and pick between them with `<picture>` and
`prefers-color-scheme`.

<!-- prettier-ignore -->
| Option | Default | Meaning |
|---|---|---|
| `--png FILE` | | The PNG to create. An existing file is never replaced. The other options require it or `--frames`. |
| `--frames DIR` | | Comparisons only, instead of `--png`: the animated playback as the viewer loops it back and forth at 1× speed, as PNG frames in the new directory `DIR` (see animations below). |
| `--fps N` | `12` | With `--frames`: how often playback is sampled, 1–60 frames a second. |
| `--theme light\|dark` | `light` | The host theme the renderer receives. |
| `--frame card\|none` | `card` | `card`: one rounded card holding the renderer's content, its legend and the summary bar, transparent outside its corners; the card hugs the content, so the image is as tall as the card, at most `--height` (`--frames` keeps every frame the viewport's size). `none`: the renderer's content alone, edge to edge and opaque, for embedding in a frame of your own. |
| `--matte COLOR` | | Card frame only: fill outside the rounded corners with `#rgb` or `#rrggbb` instead of transparency, for formats without alpha (see animations below). |
| `--width N`, `--height N` | `1280`, `800` | The viewport in CSS pixels (64–4096). The stage fills it, up to the content's height in a card; renderers scroll inside, so content beyond it is clipped. |
| `--scale N` | `1` | Device pixels per CSS pixel (0.5–4); `2` for high-density displays. |
| `--mode animated\|side-by-side\|diff` | the renderer's default | Comparisons only. Without `--mode`, the image shows the mode the Inspector opens in: the renderer's diff when it has one, else side by side. A mode the renderer doesn't offer is an error that lists the ones it does. |
| `--progress 0..1` | `1` | Animated comparisons only (it implies `--mode animated`): the transition's progress, 0 showing the base and 1 the head. |
| `--side before\|after` | | Comparisons only: one side alone, as an extraction, drawn by the renderer of the definition that explained the comparison (so a pull request's head is drawn by the base's renderer). The Action's before and after thumbnails use it. |
| `--browser PATH` | | The browser executable (see below). |
| `--timeout SECONDS` | `60`, plus a second for every five entities (at most 600) | How long the renderer may take to finish painting. |

`--from FILE` (on `show`) draws a saved extraction or comparison without
extracting anything; `--definition`, `--trust` and the container options mean
what they always do. `projections check --png FILE` draws a projection the same
way.

**Animations.** `--frames DIR` records the animated comparison as the viewer
plays it looping, at 1× speed: forward from the base to the head, a hold, then
backward, and a hold, with the renderer's own steps in each direction (motion
can differ by direction), its pace, and a hold at each step. It writes the
frames, `000.png`, `001.png` and so on, and `frames.json`, which lists each
frame's `file`, `progress`, `direction` and `durationMs`. A hold is one frame
with its whole duration, and the list starts where the hold at the base starts,
so playing the frames in order, looped, matches the viewer. Both ends show no
change highlighting. Assemble the frames with their durations, for example into
an animated PNG with ffmpeg. APNG keeps full colour and transparency, so the
card's rounded corners sit cleanly on any background, and a `.png` file plays as
an animation in browsers and on GitHub:

```sh
projections compare main..HEAD -p files --output change.json
projections show --from change.json --theme dark --scale 2 --frames frames --fps 12.5
# Each frame with its duration; ffmpeg's concat format needs the last file listed again to keep its duration.
node -e 'const {frames} = require("./frames/frames.json")
for (const f of frames) console.log(`file frames/${f.file}\nduration ${f.durationMs / 1000}`)
console.log(`file frames/${frames.at(-1).file}`)' > list.txt
ffmpeg -f concat -i list.txt -vf format=rgba -fps_mode vfr -plays 0 -f apng change-dark.png
```

GIF has only on-or-off transparency, so its corners would fringe. For a GIF,
draw the frames with `--matte` set to the background the GIF will sit on (for
example `#ffffff`, or `#0d1117` for GitHub's default dark theme), keep the theme
and matte paired, and encode with a palette:
`-vf 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none' -loop 0 change-dark.gif`.

`--scale` applies to the renderer's frame too, so a `--scale 2` image has text
as sharp as the display it is drawn for.

**Browser.** The CLI bundles no browser. It drives an installed Chrome, Chromium
or Microsoft Edge, headless, over the Chrome DevTools Protocol with a small
built-in client: `--browser PATH`, else the `PROJECTIONS_BROWSER` environment
variable, else the first of `google-chrome`, `google-chrome-stable`, `chromium`,
`chromium-browser`, `microsoft-edge`, `msedge` (and on Windows `chrome.exe`,
`msedge.exe`) on `PATH`, else the usual install locations (`/Applications/*.app`
on macOS, Program Files and the local application data directory on Windows,
`/opt/google/chrome` on Linux). Without one, the command fails and names
`--browser`. GitHub-hosted runners have Chrome. The browser's own sandbox is
never disabled, so Chrome refuses to start as root (for example in a container);
run the command as a regular user.

The browser runs with a fresh temporary profile, no extensions, sync, first-run
UI or background networking, and with every host other than `127.0.0.1`
unresolvable. On Unix it is driven over `--remote-debugging-pipe` (file
descriptors 3 and 4), so it opens no port; Windows can't pass extra descriptors,
so there it listens on an ephemeral loopback port that it records only in the
private profile. It runs in its own process group (Unix) or Job Object (Windows)
and is stopped, with everything it started, and its profile removed, on success,
failure and Ctrl+C.

**What is rendered.** The CLI computes the document exactly as `show` or
`compare` would, then opens the Inspector's mountable bundle at the reserved
origin `https://projections.invalid` with nothing listening: the DevTools Fetch
domain pauses every request of the page, its Workers and its renderer frames,
and the CLI answers each in-process (the page, the Inspector's assets, and the
Inspector service in document mode for `/api/`, `/renderers/` and
`/custom-renderers/`). The chrome-free snapshot page validates the document with
the shared Engine and presents it through the host's stage, legend included,
with the Inspector's policies: built-in renderers come from the executable, and
run in `sandbox="allow-scripts"` frames under the renderer content security
policy (no network). A definition's custom renderer is served from its
definition revision with the same trust rule as the Inspector's: one from
outside the checkout's history that differs from its merge base's needs
`--trust`; without it the built-in renderer for the schema is used, with a note
on stderr. A comparison made by a custom comparator is presented as the CLI
computed it, after both extractions are verified.

**Same input, same image.** The page reports ready only once every pane has
acknowledged painting the requested progress (the renderer's `rendered`
message), fonts have loaded and two more frames have passed, with no playback.
The browser renders in software with a fixed viewport and scale, sRGB, no font
hinting or subpixel text, hidden scrollbars, reduced motion, the `en-US` locale
and the UTC time zone. The CLI then takes screenshots until two consecutive ones
are identical (a note says so if a renderer never settles). Two images of the
same document with the same browser and fonts show the same content: the
dimensions and every pixel match, except that Chrome's software rasterizer can
round a few anti-aliased edge pixels (rounded corners) one level differently
from one launch to the next. Other machines, browser versions or system fonts
can differ more.

**Not SVG.** Images are raster only. Renderers are untrusted code that draws
inside a sandboxed frame, so an SVG they produced could carry scripts, external
references or content that escapes its frame; exporting one safely would need a
sanitizer and a renderer contract for vector output. That is future work.
