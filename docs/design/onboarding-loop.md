# Onboarding: explore, adopt, add to CI

Status: **in progress**. This records why setup starts with exploring a
repository rather than configuring CI, and the loop that replaces it.

## The problem

Setup used to end with "add the GitHub Action". That assumes people already know
which projections they want and how each should be configured. They don't, and
they can't know before they have seen a few on their own code: a projection is
only useful if it shows something meaningful about the changes this repository
actually makes. Deciding that takes a development loop: try several projections
and configurations, check each against a bunch of real changes, and keep what
earns its place.

## The loop

1. **Explore.** `projections explore` looks at the repository and proposes the
   projections that apply, without writing a file: workspace dependencies when
   it finds package manifests, a database when it finds Prisma, Django or EF
   Core models, infrastructure for Terraform or Bicep, the Actions job graph for
   workflows, the file map and API surfaces. Each candidate is a trial
   definition held in the session, and says why it was proposed ("found
   `packages/*/package.json`"). In VS Code, **Projections: Explore Repository**
   opens an **Explore** view listing them; `projections explore` prints them.
2. **Sweep.** For each candidate, or an adopted definition, run it across the
   repository's recent history: the last N merges into the current branch
   (first-parent merge commits) when merges are at least half of its last N
   first-parent commits; otherwise, as in a repository that squashes or rebases
   with a few old merges, the last N first-parent commits. N is 20 by default. A
   grid of change × projection (a row per change, so a handful of projections
   fit across) shows each cell's change count and steps and a small image of its
   Diff; cells with no change are dimmed and say "No change", and failures are
   marked. Opening a cell shows that pair in the Inspector's Diff, where the
   projection's parts can be tuned live; hovering or focusing a thumbnail shows
   it larger. To help decide, each projection's column summarizes how often it
   changed ("Changed in 6 of 20 changes · median 2 changes") and hints at its
   signal: one that changes on nearly every change (80% or more) "may be noisy",
   one that changes on a quarter or fewer "shows up for structural work".
   Columns can be ordered by that signal, the grid can show only the changes
   where something changed, and a change where two or more projections (other
   than noisy ones) changed is marked, since those make the best demonstrations.
   The column header is where a projection is ticked for adopting.
3. **Adopt.** Choose the candidates worth keeping. Adopting writes
   `.github/projections/<id>.json` (or `.projections/` when the repository
   already uses that) from the extractor's template, previewed first, and adds
   each projection's three most-changed swept changes to
   `.projections-bookmarks.json` (`<id>-pr-<number>`, titled by the pull
   request), so the team can revisit them.
4. **Add to CI.** Only now does CI enter the picture. Where the Action's step
   goes is a decision about the repository's own CI, which no command can make:
   usually a step in the job that already installs the dependencies and builds,
   so nothing installs twice, else a workflow of its own. The person's coding
   agent reads the workflows, proposes the change and writes it once they agree
   ([Add Projections to CI](../setup/ci.md)).

Every step but the last is also a command (`projections explore`,
`explore --sweep`, `adopt`) with JSON output, the last is an agent prompt
(`projections help agents ci`), and the agent skill runs the same loop: propose
candidates, sweep, report which projections show meaningful changes on which
pull requests, ask the person to choose, then build or tune. A custom extractor
is written only when no built-in one fits.

## Detection

Each built-in extractor declares, in its public descriptor, the files whose
presence means it may apply (`detects`, repository-relative glob patterns such
as `**/*.prisma`). Third-party extractors can declare the same, so discovery
isn't a first-party privilege. Explore matches the patterns against the files
Git tracks or would track (`git ls-files --cached --others --exclude-standard`)
and reports the pattern and the first matches as the candidate's basis. An
extractor that declares nothing is never proposed (for example `command-output`,
which needs a command). Detection reads only file names; it runs nothing.

A candidate whose ID an authored definition already uses is shown as adopted
instead.

## Sweeps

- **Pairs.** First-parent merge commits on the current branch, each compared
  with its first parent: what each merged pull request did. Repositories that
  squash or rebase have no merge commits, so the last N first-parent commits are
  used instead, each with its parent. A change is labelled by the pull request
  number its message names (`#123`), and a GitHub merge commit by its pull
  request's title (the message body's first line).
- **One definition.** Every revision is extracted with the working tree's
  definition (as `compare --definition-revision working-tree`), so a sweep tests
  the projection being tuned, not whatever each revision committed.
- **Cache.** Extractions are cached by the definition's digest (its canonical
  definition and every declared source file) and the revision's Git tree, so
  rerunning a sweep after tuning only extracts what changed, and the two sides
  of consecutive merges share work. Each revision is materialized once for every
  projection. The extension's backend (`serve --stdio`) keeps the cache for its
  lifetime (the oldest 2,000 extractions are dropped first); `explore --sweep`
  for one run.
- **Bounds.** At most two extractor processes run at once, the default number of
  pairs is 20 (at most 100), and Diff images are drawn one at a time, only for
  cells that changed, when they scroll into view (a 960 × 600 view at half
  scale; the Diff when the renderer draws one, else its default view). Each
  extraction keeps the extractor protocol's own time and output limits. Starting
  a sweep cancels the one before.
- **Trust.** Built-in extractors that run no repository code sweep without
  trust. Candidates or definitions that run repository code are listed but
  skipped without `--trust`, saying so.

## Writing files

Explore writes nothing until the person adopts, and each write is previewed
first. Adopting never overwrites an existing file. A preview returns a digest of
the files' current contents, and a write with that digest is refused when they
changed since. Through the extension's backend (`serve --stdio`) these writes
are allowed in an explore session or with `--trust`; previews are always
allowed.

The Action extracts every projection the repository defines, so "exactly the
adopted projections" holds without the Action taking a list, and adopting
another later needs no CI change. It asks only for `contents: read`, and needs
`trust: true` only when an adopted projection runs repository code.

An earlier `projections publish` wrote a standalone workflow. It was removed: a
workflow of its own installs the dependencies again, misses the runners,
branches, filters and permissions the repository's CI already has, and can't
know whether the step belongs after an existing build. That needs judgment about
the repository's CI, which the agent guidance asks for instead.

## Open questions

- **A hosted, no-install trial.** A hosted view could run the pure-parser
  built-in extractors (those that run no repository code, such as workspace
  dependencies, Prisma, the Actions job graph and the file map) on a
  repository's recent pull requests through the GitHub API, so people can see
  their own projections before installing anything. No repository code would
  run, and the site would still only display, never collect on its own. Open:
  who pays for and bounds the extraction work, how private repositories are
  authorized, whether results are cached and for how long, and how that differs
  from the site's current rule that CI produces everything it shows. Not built.
- **Meaningful changes.** A sweep counts changes and steps. Ranking cells by how
  informative a change is (for example many small renames versus one new
  service) is left to people and agents for now.
- **Configuration search.** Explore proposes each extractor's template. It could
  also try input variants (a workspace root, a schema path) and keep the ones
  that extract more.
