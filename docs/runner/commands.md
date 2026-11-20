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

- `explore` proposes built-in projections that fit this repository by matching
  Git-tracked files against each extractor's `detects` patterns, listing the
  files that suggested each candidate without writing anything. By default it
  prints the candidates along with instructions for trying them in VS Code
  (**Projections: Explore Repository**, whose Explore view sweeps them); pass
  `--list` to print only the candidates. Pass `--sweep` to run every candidate
  and defined projection across the last `--last N` (default 20, maximum 100)
  first-parent merges into the branch when merges make up at least half of
  recent first-parent commits—or across first-parent commits for repositories
  that squash or rebase. Each revision is extracted using the working tree's
  definition with up to `--concurrency N` (default 2) extractors in parallel,
  and results are ranked best signal first: projections that changed on at most
  a quarter of changes (likely structural) appear ahead of those that changed
  more often, those that changed on four in five or more (likely noise), and
  those that never changed, followed by a summary of which are worth a look.
  Fewer than four changes aren't judged. Use `-p ID` to narrow the sweep, and
  `--json` to print the `projections.sweep` document with each ready
  projection's `signal` (`rare`, `steady`, `unknown`, `noisy`, or `quiet`).
  Projections that run repository code are skipped unless `--trust` is passed.
- `adopt ID...` writes definitions for the chosen explore candidates into
  `.github/projections/ID.json` (or `.projections/` if the repository uses it,
  never overwriting an existing file) and adds the `--bookmarks N` (default 3)
  changes where each moved the most—from a sweep of the last `--last N`
  changes—to `.projections-bookmarks.json`. Pass `--dry-run` to preview the
  files without writing them.
- `init [ID]` scaffolds a new projection, adds parts to an existing one, and
  writes or updates the agent skill (`projections/SKILL.md`, placed in whichever
  skills directory already holds it, otherwise whichever of `.agents/skills`,
  `.claude/skills`, or `.github/skills` holds the repository's own skills, and
  otherwise `.agents/skills`; override with `--skills-dir DIR`, skip with
  `--no-skill`, or add to `.claude/skills` for Claude Code with `--claude`—see
  [agent skills](../setup/agent-skills.md)), printing where it wrote. A new
  projection gets a starter extractor matching the project's toolchain (Node
  when the root has `package.json`; Python for `pyproject.toml`,
  `requirements.txt`, `setup.py`, or `Pipfile`; Go for `go.mod`; otherwise pass
  `--language node|python|go`) and the built-in `graph` renderer. Pass
  `--extractor ID` or `--command ARGV_JSON` to use a built-in extractor or an
  existing command instead, `--renderer NAME` to pick a built-in renderer,
  `--renderer custom` to scaffold a renderer package (TypeScript, Vite, React,
  the renderer SDK, and kit) in `ID/renderer/`, or `--comparator custom` to
  scaffold a starter comparator file (`ID/ID.comparator.yaml`) and its tests.
  For an existing projection, only the requested parts are added and only their
  definition fields are updated. Calling it without `ID` writes only the skill.
  It never overwrites existing projection files and never runs code. Because
  `@githubnext/projections` isn't published to npm yet, custom renderers depend
  on the tarball attached to this CLI's GitHub release by URL; setting
  `PROJECTIONS_RENDERER_PACKAGES=DIR` installs it from an `npm pack` tarball in
  `DIR` (for instance, one built from a Git submodule), while a development
  build from a clone (`npm run tools -- install`) uses a `file:` reference to
  `dist/dogfood/githubnext-projections.tgz`.
- `check [-p ID]...` verifies projections end to end (all projections defined in
  the working tree by default). It confirms that the definition is valid, the
  working tree extracts cleanly, and a rerun produces the same extraction up to
  declared `volatile` fields and their tolerances (judged by the Engine's
  `vary`; unexpected variation warns and names the differing items and fields,
  `--strict-determinism` turns that warning into a failure, and `observed`
  extractions aren't rerun; reworded generated values from an equal basis are
  expected variation with a note to reuse them via the
  [generation store](caches.md#generation-store), while a `pure` definition that
  produces generated values warns). It also checks that any declared scope holds
  when extracting only the scope (see [Scopes](execution.md#scopes)), that a
  custom extractor produces the same result when run from a copy containing only
  the definition's own files—warning if it reads files beside itself, which
  comparisons always take from the definition revision on both sides (see
  [Definitions and execution](execution.md#exact-source-and-explicit-execution))—and
  that a custom extractor's `data` doesn't embed fields that change when
  unrelated items change (warning on counts or lists of external items like
  `fileCount` or `importers`, or line numbers, unless read by the definition or
  declared volatile, since they mark items modified unnecessarily). Finally, it
  compares `HEAD` against the working tree using the working tree's definition,
  runs any comparator tests beside a custom comparator file
  (`*.comparator.test.yaml`, with `--update` to rewrite snapshots and
  `--coverage` to report exercised functions, expressions, and branches—see
  [Comparator tests](stdio-backend.md#comparator-tests)), checks that a custom
  renderer's bundle is built and newer than its sources, and runs the standard
  renderer checks in a headless browser against the working tree, the comparison
  (formatted per the definition's `presentation`), and a custom renderer
  package's `scenarios.json`. Each check reports `pass`, `fail`, `warn`, or
  `skip` in plain words, and the command exits nonzero if any check fails. Pass
  `--png FILE` to also render the single projection's working tree (failing only
  that step if the file already exists), `--from FILE` to check raw extractor
  output for that projection without extracting or comparing, `--no-render` to
  skip the browser checks, `--parity REV` to compare a local extraction against
  CI's (see [CI artifacts](caches.md#ci-artifacts-as-a-source)), or `--json` to
  print the `projections.check` document.
- `doctor [-p ID]...` inspects what this checkout needs to run its projections:
  the Git checkout and commits, definition validity, the environment (what is
  declared, what the working tree has prepared, stale steps, and missing tools),
  the active workspace strategy and why it was chosen, each extractor's program
  and files, custom renderer bundles (and running dev servers), comparator
  files, the agent skill, and an available browser for images and checks. It
  never runs repository code or modifies files, exits nonzero if anything is
  missing, and supports `--json` for the `projections.doctor` document.
- `prepare` runs the environment file's prepare steps in the working tree—or,
  with `--revision REV`, in the workspace for that commit. Each step runs only
  if its key files changed since its last run there (`--force` reruns all steps;
  `--step ID` selects specific ones). Requires `--trust` and supports `--json`
  for the `projections.prepare` document. See
  [Environments and workspaces](environments.md#environments-and-workspaces).
- `workspace list` and `workspace clean` inspect the workspaces Projections
  keeps for toolchain extractions of other commits and delete any that aren't in
  use.
- `show [REVISION]` runs a projection's extractor on a single revision (the
  working tree by default) and prints the result. Specify the projection with
  `-p ID` (optional if the revision defines only one) or use `--all` to show
  every defined projection. Pass `--definition-revision REV` to apply another
  revision's definition so extractions across revisions can be compared later.
  With `--from FILE`, `show` renders a saved extraction or comparison without
  running an extractor; combined with `-p ID`, `FILE` is treated as raw
  extractor stdout (even hand-written), which the working tree's definition
  normalizes, digests, and validates. Pass `--png FILE` to also render an image
  (see [Images](#images)).
- `compare <BASE>[..<HEAD>]` extracts both revisions using one definition, runs
  the comparator, and prints the comparison. Passing a single revision compares
  it with the working tree; `<BASE>...<HEAD>` starts at their merge base; an
  empty side defaults to `HEAD`, just like Git. Use `-p ID` for one projection
  or `--all` for every projection defined in either revision. Choose which
  revision's definition and component code apply to both sides with
  `--definition base|head`, or pick another revision with
  `--definition-revision REV` (such as `working-tree` to test uncommitted
  projection code against real history). To compare saved extractions without
  running extractors, pass
  `--before-extraction FILE --after-extraction FILE [--comparator FILE]`. Add
  `--png FILE` to render an image too.
- `list` prints the validated definitions at `--revision` (working tree by
  default) along with `requiresTrust` and `rendererRequiresTrust`, without
  running any code. `defaults` indicates when the working tree has no authored
  definitions and the built-in defaults (`workspace-dependencies` and
  `repository-map`) apply; once you author projections, the defaults disappear
  from `list` but remain addressable by ID (`-p repository-map`) unless a
  definition reuses that ID. Invalid definition files never hide valid ones:
  `invalid` lists each with its `path` and `diagnostics` (including the field's
  `pointer` and `location`, `{path, line, column}`), text output prints
  `id: invalid: path:line:column: message`, and the command exits nonzero.
- `serve --stdio` runs the Inspector's JSON-RPC backend over standard input and
  output (with no port or listener) for editor extensions such as VS Code. It
  serves the live working tree by default, a saved extraction, comparison, or
  pull request review with `--document FILE` (running nothing), or scenario
  fixtures for renderer and comparator development with `--fixtures` (see
  [Stdio backend](stdio-backend.md)). Pass `--trust` to allow repository code.
- `mcp` exposes Projections' [agent tools](agent-tools.md) as a Model Context
  Protocol server over standard input and output for coding agents like GitHub
  Copilot CLI, Claude Code, or any other MCP client. Pass `--trust` to allow
  running repository code and writing outside an explore session.
- `bookmark list` and `bookmark run [ID]...` list or run saved comparisons from
  `.projections-bookmarks.json` (running all of them by default as a batch).
  Each bookmark uses its base revision's definition, falling back to the working
  tree's definition with a notice if neither revision defines the projection (as
  with a bookmark created before the projection existed). Override with
  `--definition base|head` to insist on one side, or `--definition-revision REV`
  to apply a single revision's definition to every bookmark.
- `pr NUMBER|URL` runs an untrusted review of an existing GitHub pull request;
  see [Untrusted pull request review](pull-requests.md).
- `extractor list` and `extractor view ID` list built-in extractors and show
  each one's inputs, schema, renderer, execution policy, and definition
  template.
- `validate FILE|-` validates a saved extraction, comparison, or scenarios
  document (`-` reads from standard input). Pass `--json` for structured output
  or `--quiet` to suppress output. Custom comparator comparisons are only
  reproduced when you supply `--comparator FILE`; otherwise the output records
  `"reproduced": false`.
- `help [COMMAND|TOPIC]` shows help for a command, `help authoring` prints the
  projection authoring guide (the same text as the agent skill), and
  `help agents [NAME]` prints the bundled coding-agent prompts (`explore`,
  `create-projection`, `ci`, `install`, matching `docs/agents/*.md`).
- `licenses` prints the license and third-party notices for everything bundled
  in the executable.

Every command accepts `-C DIR` (`--directory`) pointing to any directory inside
a Git checkout and resolves its top level automatically, so commands work from
subdirectories even without the flag. Commands that run extractors also accept
`--trust` and the container isolation options. Because every working tree
records the commit it is based on, the repository must have at least one commit.

Commands that extract also share `--no-cache` (bypass the
[extraction cache](caches.md#extraction-cache)), `--ci` and `--artifact DIR`
(reuse [CI artifacts](caches.md#ci-artifacts-as-a-source)), `--in-place`
(extract a commit matching the checkout's `HEAD` in place even when untracked
files exist, as in CI), `--workspace STRATEGY` (see
[Environments and workspaces](environments.md#environments-and-workspaces)), and
`--regenerate` (recompute [generated values](caches.md#generation-store) instead
of reusing stored ones). `serve --stdio` and `mcp` accept the same options.

## Errors

When a command fails, it writes an error message and next steps to stderr and
exits with status 1 (or 2 for an invalid command line). Extractor failures
include the exit status and stderr; invalid extractions list every issue with
its error code and JSON pointer. When `--json` or `--output` is set, failures
also print a `projections.error` document to stdout so scripts and agents can
handle them programmatically:

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

The `code` field is one of `TRUST_REQUIRED`, `EXTRACTOR_FAILED` (which includes
`stderr`), `INVALID_EXTRACTION`, `INVALID_INPUT`, or `ERROR`. Failed processes
are identified by filename (or extractor ID for built-ins), never by the
absolute path they ran from. The Inspector and VS Code extension surface the
extractor's own error once—picking the key stderr line (an `Extractor <id>:`
message, the first `Error:`-style line, the last line of a Python traceback, or
a Rust panic message) without source excerpts—while tucking the full stderr
under **Raw output**.

## Output

By default, `show` and `compare` output accessible plain text without colors,
ASCII art, or symbols that depend on sight. `show` groups entities by kind and
lists each entity's outgoing relationships beneath it. `compare` prints both
revisions, the comparator and definition digest, any definition notices, status
counts, and each step in order with its changes (`Added`, `Removed`, `Changed`,
`Renamed`, `Split`, `Merged`) and summaries.

Pass `--json` to print the structured document instead: `projections.extraction`
(version 0), `projections.comparison` (version 0), or—for `--all` and
`bookmark run`—`projections.batch` (version 0). Pass `--output FILE` to write
that JSON to a new file (never overwriting an existing one), pretty-printed with
two-space indentation (falling back to compact JSON only if needed to fit the
size limits) and printing nothing to stdout. Comparison documents include
definition notices in `notices` (omitted when empty), as do batch items; in JSON
modes, notices are also echoed to stderr as `projections: note: ...`.

If a declared input (a file, folder, or glob named in a built-in's `inputs`)
does not exist at a revision, the built-in produces an empty extraction and
records the path in `missingInputs` instead of failing. In a comparison,
`compare` then shows the contents as added (if missing before) or removed (if
missing after) with a notice naming the input and revision. `show` prints a
note, and explains that the projection has nothing to show when the extraction
is empty. `check` still fails its extraction step, since a missing input at the
checked revision is a misconfiguration. An input file that exists but fails to
parse remains an error.

## Images

Pass `--png FILE` to `show` or `compare` to save a PNG of what the Inspector
renders—useful for READMEs, pull request comments, or anywhere that displays
images but cannot run a live renderer. Normal text (or JSON) output is still
printed as usual:

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

By default, the PNG renders as a single rounded card with a hairline border: the
renderer's content at the top, followed by its legend and summary bar separated
by hairlines. The area outside the rounded corners is transparent with a pixel
of breathing room around the card, so it blends cleanly onto any background,
including GitHub's light and dark READMEs. Card surfaces, borders, and rules
follow `--theme`; for a README, render one image per theme and switch between
them using `<picture>` and `prefers-color-scheme`.

<!-- prettier-ignore -->
| Option | Default | Meaning |
|---|---|---|
| `--png FILE` | | Path of the PNG to create. Never overwrites an existing file. All other image options require this or `--frames`. |
| `--frames DIR` | | Comparisons only (instead of `--png`): captures the animated playback as the viewer loops it back and forth at 1× speed, writing PNG frames into the new directory `DIR` (see animations below). |
| `--fps N` | `12` | Used with `--frames`: sampling rate from 1–60 frames per second. |
| `--theme light\|dark` | `light` | Host theme passed to the renderer. |
| `--frame card\|none` | `card` | `card` wraps the renderer's content, legend, and summary bar in a rounded card with transparent corners, shrinking vertically to hug the content up to `--height` (`--frames` keeps every frame at the full viewport size). `none` outputs the renderer's content edge to edge and opaque for embedding in your own frame. |
| `--matte COLOR` | | Card frame only: fills outside the rounded corners with `#rgb` or `#rrggbb` instead of transparency, for image formats without alpha (see animations below). |
| `--width N`, `--height N` | `1280`, `800` | Viewport dimensions in CSS pixels (64–4096). The stage fills the viewport up to the content's height in card mode; overflowing content is clipped since renderers scroll internally. |
| `--scale N` | `1` | Device pixels per CSS pixel (0.5–4); use `2` for high-density displays. |
| `--mode animated\|side-by-side\|diff` | the renderer's default | Comparisons only. Without `--mode`, it defaults to the mode the Inspector opens in: the renderer's diff if it supports one, otherwise side by side. Choosing an unsupported mode fails and lists the available modes. |
| `--progress 0..1` | `1` | Animated comparisons only (implies `--mode animated`): transition progress, from 0 (base) to 1 (head). |
| `--side before\|after` | | Comparisons only: renders a single side as an extraction using the renderer from the comparison's definition (so a pull request's head is drawn by the base's renderer). Used by the Action's before and after thumbnails. |
| `--browser PATH` | | Path to the browser executable (see below). |
| `--timeout SECONDS` | `60`, plus a second for every five entities (at most 600) | Maximum time the renderer has to finish painting. |

On `show`, `--from FILE` renders a saved extraction or comparison without
running any extractor; `--definition`, `--trust`, and the container options
behave as usual. `projections check --png FILE` renders a projection the same
way.

**Animations.** Passing `--frames DIR` captures an animated comparison exactly
as the viewer loops it at 1× speed: forward from base to head, a hold, backward
to base, and a hold—preserving direction-specific motion, pacing, and per-step
holds. It writes `000.png`, `001.png`, and so on, alongside `frames.json`
listing each frame's `file`, `progress`, `direction`, and `durationMs`. Each
hold is emitted as a single frame with its full duration, starting at the base
hold so looping the sequence matches the viewer; both endpoints omit change
highlighting. You can assemble the frames into an animated PNG with ffmpeg—APNG
preserves full color and alpha transparency so the rounded card sits cleanly on
any background, and `.png` animations play natively in browsers and on GitHub:

```sh
projections compare main..HEAD -p files --output change.json
projections show --from change.json --theme dark --scale 2 --frames frames --fps 12.5
# Each frame with its duration; ffmpeg's concat format needs the last file listed again to keep its duration.
node -e 'const {frames} = require("./frames/frames.json")
for (const f of frames) console.log(`file frames/${f.file}\nduration ${f.durationMs / 1000}`)
console.log(`file frames/${frames.at(-1).file}`)' > list.txt
ffmpeg -f concat -i list.txt -vf format=rgba -fps_mode vfr -plays 0 -f apng change-dark.png
```

Because GIF only supports binary transparency (which causes fringing on rounded
corners), pass `--matte` matching the target background (for example `#ffffff`,
or `#0d1117` for GitHub's default dark theme), keep theme and matte paired, and
encode with a palette:
`-vf 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none' -loop 0 change-dark.gif`.

`--scale` applies inside the renderer's frame as well, so `--scale 2` produces
crisp text for high-density displays.

**Browser.** The CLI does not bundle a browser. Instead, it drives an installed
Chrome, Chromium, or Microsoft Edge headlessly over the Chrome DevTools Protocol
using a lightweight built-in client. It looks for a browser in this order:
`--browser PATH`, the `PROJECTIONS_BROWSER` environment variable, the first
match on `PATH` among `google-chrome`, `google-chrome-stable`, `chromium`,
`chromium-browser`, `microsoft-edge`, `msedge` (plus `chrome.exe` and
`msedge.exe` on Windows), and finally standard install paths
(`/Applications/*.app` on macOS, Program Files and local AppData on Windows,
`/opt/google/chrome` on Linux). If none is found, the command fails and mentions
`--browser`. GitHub-hosted runners include Chrome out of the box. Because the
CLI never disables the browser's sandbox, Chrome will refuse to launch as root
(such as inside a container)—run the command as a regular user.

The browser launches with a clean temporary profile, no extensions, sync,
first-run UI, or background networking, and blocks DNS resolution for every host
except `127.0.0.1`. On Unix it communicates over `--remote-debugging-pipe` (file
descriptors 3 and 4) without opening a port; on Windows, where extra descriptors
cannot be passed, it binds an ephemeral loopback port recorded only in the
private profile. The browser runs in its own process group (Unix) or Job Object
(Windows) and is shut down cleanly—along with its child processes and temporary
profile—on success, failure, or Ctrl+C.

Across all processes for a user, at most two browsers launch at the same time:
each launch holds one of two lock files in `browser-launches/` inside the cache
directory until its DevTools connection responds. This staggers parallel test
runs or concurrent sessions so macOS doesn't abort simultaneous launches. If a
browser is killed by a signal before responding, the CLI retries launching it
once. A single `check` run reuses one browser across every projection's renderer
checks and image, and the Inspector service keeps its thumbnail/screenshot
browser alive for 30 seconds after each render; every render still uses an
isolated browser context so no state leaks between them.

**What is rendered.** The CLI computes the document identically to `show` or
`compare`, then opens the Inspector's mountable bundle at the reserved origin
`https://projections.invalid` with no listening server. Using the DevTools Fetch
domain, the CLI intercepts every request from the page, its Workers, and its
renderer frames and answers them in-process (serving the page, Inspector assets,
and the Inspector service in document mode for `/api/`, `/renderers/`, and
`/custom-renderers/`). The chrome-free snapshot page validates the document with
the shared Engine and renders it through the host stage—legend included—under
the Inspector's normal policies: built-in renderers come from the executable and
run inside `sandbox="allow-scripts"` frames with a strict content security
policy (no network). Custom renderers are served from their definition revision
under the same [trust rule](../contracts.md#trust) as the Inspector: a renderer
that differs from the default branch's requires `--trust` (also accepted with
`--from` and `--before-extraction`, where it authorizes only the renderer);
without `--trust`, the CLI falls back to the built-in renderer for that schema
and notes it on stderr. Custom comparator comparisons are displayed as computed
once both extractions pass verification.

**Same input, same image.** The snapshot page signals readiness only after every
pane has acknowledged painting the requested progress (via the renderer's
`rendered` message), fonts have loaded, and two additional frames have elapsed
with playback paused. Rendering runs in software with a fixed viewport and
scale, sRGB color, no font hinting or subpixel text, hidden scrollbars, reduced
motion, the `en-US` locale, and UTC. The CLI then captures screenshots until two
consecutive frames are identical (printing a note if a renderer never settles).
Two renders of the same document with the same browser and fonts match in
dimensions and pixels, aside from minor one-level anti-aliasing variations
Chrome's software rasterizer occasionally produces on rounded corners across
launches; different machines, browser versions, or system fonts can vary more.

**Not SVG.** Image output is raster-only. Because renderers are untrusted code
running inside sandboxed frames, an SVG they emit could contain scripts,
external references, or markup that escapes its frame. Supporting safe vector
export would require a sanitizer and a dedicated vector renderer contract, which
remains future work.
