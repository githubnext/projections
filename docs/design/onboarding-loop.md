# Onboarding: explore, adopt, add to CI

Status: **in progress**. This note explains why onboarding now starts with
exploring a repository rather than wiring up CI, and lays out the loop that
replaces the old setup flow.

## The problem

Our old setup flow jumped straight to "add the GitHub Action." That assumes you
already know which projections you want and how to configure them. In practice,
nobody knows that before seeing a few projections run against their own code. A
projection only earns its keep when it illuminates the changes a repository
actually makes, and figuring that out takes a quick feedback loop: try several
candidates, test them against real history, and keep the ones that carry signal.

## The loop

1. **Explore.** Running `projections explore` scans the repository and suggests
   projections that might fit without writing any files: workspace dependencies
   for package manifests, a database schema for Prisma, Django, or EF Core
   models, infrastructure for Terraform or Bicep, the Actions job graph for
   workflows, plus the file map and API surfaces. Each candidate stays in the
   session as a trial definition and explains why it showed up (for instance,
   "found `packages/*/package.json`"). In VS Code, **Projections: Explore
   Repository** opens an **Explore** view listing the candidates;
   `projections explore` prints them in the terminal.
2. **Sweep.** Next, run each candidate (or an already adopted definition) across
   recent repository history. By default, N is 20. If at least half of the last
   N first-parent commits on the current branch are merge commits, the sweep
   uses the last N first-parent merge commits; otherwise (such as in repos that
   squash or rebase, with only a few old merges) it uses the last N first-parent
   commits.

   The results appear as a change × projection grid, with one row per change so
   several projections fit side by side. Each cell shows its change count,
   steps, and a thumbnail of its Diff; unchanged cells are dimmed with "No
   change", and failures are flagged. Clicking a cell opens that pair in the
   Inspector's Diff so you can tune the projection live, and hovering or
   focusing a thumbnail enlarges it.

   To make picking easier, each column header summarizes how often that
   projection moved ("Changed in 6 of 20 changes · median 2 changes") and hints
   at its signal: anything firing on 80% or more of changes "may be noisy",
   while one firing on a quarter or fewer "shows up for structural work". You
   can sort columns by signal, filter the grid to changes where something moved,
   and spot rows where two or more non-noisy projections changed together —
   those usually make the best demos. Tick a projection in its column header to
   mark it for adoption.

3. **Adopt.** Once you know which candidates are worth keeping, adopting writes
   `.github/projections/<id>.json` (or `.projections/` if the repository already
   uses that folder) from the extractor's template after showing a preview. It
   also saves each projection's three most-changed swept items into
   `.projections-bookmarks.json` (`<id>-pr-<number>`, titled by the pull
   request) so your team can jump straight to good examples.
4. **Add to CI.** Only after you have useful projections does CI come in.
   Deciding where the Action step belongs is a judgment call about the
   repository's existing workflows that no canned command can make. Usually it
   fits inside the job that already installs dependencies and builds, avoiding a
   duplicate install; otherwise it goes in its own workflow. Your coding agent
   reads the existing workflows, proposes the edit, and applies it once you
   approve ([Add Projections to CI](../setup/ci.md)).

Every step except CI has a CLI command (`projections explore`,
`explore --sweep`, `adopt`) with JSON output. The CI step is an agent prompt
(`projections help agents ci`), and the agent skill follows the exact same loop:
propose candidates, sweep, report which projections surfaced meaningful changes
on which pull requests, ask you to pick, and then build or tune. You only write
a custom extractor when no built-in fits.

## Detection

Each built-in extractor declares a `detects` list in its public descriptor —
repository-relative glob patterns like `**/*.prisma` that suggest the extractor
may apply. Third-party extractors can declare the same field, so discovery isn't
reserved for first-party built-ins. Explore matches those patterns against the
files Git tracks or would track
(`git ls-files --cached --others --exclude-standard`) and reports the matching
pattern and first few files as its reason. Extractors that declare no patterns
(like `command-output`, which needs a command) are never proposed. Detection
only inspects file names and executes nothing.

If a candidate's ID is already used by an authored definition, it appears as
adopted instead.

## Sweeps

- **Pairs.** On branches with merge commits, each first-parent merge commit is
  compared against its first parent to capture what the merged pull request
  changed. In repositories that squash or rebase, each of the last N
  first-parent commits is compared against its parent. Changes are labeled with
  the pull request number from their commit message (`#123`), and GitHub merge
  commits use the pull request title from the first line of the message body.
- **One definition.** Every revision is extracted with the working tree's
  definition (matching `compare --definition-revision working-tree`), so a sweep
  evaluates the projection you are tuning rather than whatever older definition
  lived in that historical commit.
- **Cache.** Extractions are cached by the definition's digest (covering the
  canonical definition and every declared source file) plus the revision's Git
  tree. When you tune a projection and re-run a sweep, only what actually
  changed gets re-extracted, and adjacent merges share work across their common
  sides. Each revision is materialized once for all projections. The extension's
  backend (`serve --stdio`) keeps the cache for its lifetime (evicting the
  oldest entries past 2,000 extractions), while `explore --sweep` keeps it for
  that run.
- **Bounds.** At most two extractor processes run concurrently. Sweeps default
  to 20 pairs (capped at 100), and Diff thumbnails render one at a time, only
  for changed cells, as they scroll into view (960 × 600 at half scale, showing
  the Diff when the renderer has one and its default view otherwise). Every
  extraction still obeys the extractor protocol's time and output limits, and
  starting a new sweep cancels any previous one.
- **Trust.** Built-in extractors that don't execute repository code sweep
  without needing trust. Candidates or definitions that do run repository code
  are still listed, but skipped with an explanation unless `--trust` is passed.

## Writing files

Explore never touches disk until you explicitly adopt, and every write is
previewed first. Adopting never overwrites an existing file. Each preview
returns a digest of the target files' current contents, and the write is refused
if anything changed on disk in the meantime. Through the extension's backend
(`serve --stdio`), writes are permitted inside an explore session or with
`--trust`, while previews are always allowed.

Because the GitHub Action extracts every projection defined in the repository,
"exactly the adopted projections" works automatically without maintaining a
separate list in the workflow. Adding another projection later requires no CI
edit. The Action only asks for `contents: read`, and only needs `trust: true` if
an adopted projection runs repository code.

We removed an earlier `projections publish` command that generated a standalone
workflow file. A separate workflow re-installs dependencies from scratch, misses
the runners, branch filters, and permissions a repository's CI already uses, and
can't tell whether the step belongs after an existing build. That takes human
judgment about the repository's CI, which is why the agent guidance handles it
instead.

## Open questions

- **A hosted, no-install trial.** A hosted view could run the pure-parser
  built-in extractors (the ones that execute no repository code, like workspace
  dependencies, Prisma, the Actions job graph, and the file map) against a
  repository's recent pull requests via the GitHub API. People could see
  projections on their own code before installing anything, without running
  repository code and while keeping the site display-only. What's still open:
  who pays for and bounds the extraction work, how private repositories are
  authorized, how long results should be cached, and how that squares with the
  site's current rule that CI produces everything it displays. Nothing here is
  built yet.
- **Meaningful changes.** Right now a sweep just counts changes and steps.
  Ranking cells by how informative they are (say, distinguishing dozens of small
  renames from one brand-new service) is left to people and agents for now.
- **Configuration search.** Today Explore only proposes each extractor's default
  template. Later it could try input variations (like different workspace roots
  or schema paths) and keep whichever extracts the most.
