# Changelog

What changed in each release of Projections. A version's section is the body of its [GitHub release](https://github.com/githubnext/projections/releases), and its release candidates use it too ([release notes](docs/maintainers/releasing.md#release-notes)).

## v0.2.0

Projections 0.2.0 adds built-ins for Rails and GitHub Agentic Workflows, makes the agent viewer easier to drive and to show in other apps (Claude Code's Preview pane among them), and tightens what runs without `--trust`. Read [Behaviour changes](#behaviour-changes) before upgrading: some can turn a passing check red.

### Security

- Custom renderers from a checked-out pull request ran without `--trust` (#19), and `--ci` treated artifacts from fork pull requests as official (#18). Both are fixed; see [Behaviour changes](#behaviour-changes).
- Upgrade from 0.1.0. If you used `--ci`, delete the `artifacts/` and `extractions/` directories in the [per-user cache](https://github.com/githubnext/projections/blob/main/docs/runner/caches.md) (`~/.cache/projections` on Linux, `~/Library/Caches/projections` on macOS, `%LOCALAPPDATA%\projections` on Windows).

### Behaviour changes

- **A repository's custom renderers run only with `--trust`** (#19). A custom renderer bundle is repository code, so it now follows the same rule as a custom extractor: `--trust` on the CLI, a trusted workspace in VS Code, `trust: true` in the Action. Before, a renderer from the working tree or any commit in `HEAD`'s history ran without trust, including a pull request's head once checked out. Without trust, hosts draw with the built-in renderer for the schema and show a notice.
  - The one exception is a bundle whose `index.html` and `renderer.json` are byte-identical to the ones the projection declares at the merge base with the default branch (`refs/remotes/origin/HEAD`; `git remote set-head origin --auto` sets it). Without `origin/HEAD` there is no exception.
  - `projections check`: a custom renderer's checks now fail without trust. Pass `--trust`, or `--no-render` to skip them. CI that checks such a projection needs `trust: true` in the Action, or `--trust`.
  - Authoring: uncommitted renderer edits differ from the default branch, so pass `--trust` to `view`, `serve`, `show --png` and `check` while you write a renderer. A renderer development server serves the package's live sources, so the Inspector and viewer use it only with `--trust`.
  - Scenarios: a bundle a scenarios document names runs only when named explicitly (`serve --fixtures … --renderer DIR`, or the projection's own bundle in `check`) or with `--trust`. VS Code's **Open Renderer Scenarios** passes the package's own renderer only in a trusted workspace, and warns otherwise.
  - `show --from` and `compare --before-extraction` now accept `--trust`, which allows only the renderer, since nothing is extracted.
- **`--ci` calls only authenticated artifacts official** (#18).
  - `--ci` downloads only from a successful run of the Projections workflow in this repository, for a `push` or a same-repository `pull_request`, never a fork's. The workflow is the one `--ci-workflow FILE` or the `ciWorkflows` setting names, else one whose file on the default branch uses `githubnext/projections`.
  - Artifacts v0.1.0 downloaded have no record of their run, so they aren't used until a run passes these checks and they're downloaded again.
  - An `--artifact DIR` is labelled imported (`official: false`) unless, with `--ci`, `gh attestation verify` verifies its manifest's attestation and that names a run passing the same checks. The Action's new `attest` input (default `false`; needs `id-token: write` and `attestations: write`) attests the artifact.
  - Provenance records how the run was established (`provenance.execution.ci.authentication`: `download` or `attestation`). In the Action, a pull request comparison's reused base side is now labelled imported. VS Code's badge reads **Imported** for an unauthenticated artifact, and **From CI** only for an official one.
- **The MCP App is removed** (#38). `projections mcp` no longer serves the viewer as an MCP App, the inline view that MCP Apps hosts such as Claude Desktop showed in the conversation (`ui://projections/viewer`, its `resources/*` methods and the app-only `viewer_request` tool). `projections mcp` and every tool remain: an MCP Apps host gets the same tools as any client, and `open_projection` gives the viewer's URL for the agent to open in its own browser.
- **The viewer keeps its URL across restarts** (#17).
  - The token and port are kept per project in the user cache, readable only by you, so a viewer restarted after `view stop`, its idle exit or a reboot serves the same link.
  - `projections view stop --rotate` forgets it: the next viewer gets a new token, and earlier links stop working.
  - `view --port N` and `view show --port N` refuse while the project's viewer runs on another port, and refuse a taken port rather than picking another.
- **The agent `compare` tool applies the viewer's definition to the viewer's pair** (#7). Comparing the pair the viewer shows, or a suggested pair such as a bookmark, without naming revisions now applies the definition the viewer applies (usually the working tree's) instead of the base revision's, so the result matches what's on screen and can differ from before. Pass `definition: base` for the previous choice. Given revisions keep the base/head rule.
- **A bare `python` or `python3` command runs Python 3** (#5). In an extractor's or prepare step's command, the runner tries the name as written, then the other name, then `py -3`, and runs the first that reports Python 3. A `python` that is Python 2 is passed over, and with no Python 3 the command fails. Name a path, such as `.venv/bin/python`, to run an interpreter as written. Inside a container (`--isolation container`), commands run as written.
- **`projections init` may put the agent skill elsewhere** (#22). Among `.agents/skills`, `.claude/skills` and `.github/skills`, it now picks the one holding most of the repository's own skills (the most widely read breaks ties) and says why. `--no-skill` writes none.

### Highlights

- **Rails built-ins** (#21). `rails-schema` reads `db/schema.rb` into the `database` renderer, and `rails-routes` evaluates the routing DSL into the `api` renderer. Both read files only: no Ruby, gems, Rails boot or database, no `--trust`, and every revision of a history.
- **GitHub Agentic Workflows** (#29, #30, #31). A built-in extractor, comparator file and renderer for [gh-aw](https://github.com/github/gh-aw) workflows. They show what starts each workflow, what its agent can reach and write, and lock files out of date, and read each change by direction: a widened permission, network allowlist, tool, repository scope or safe output is a warning, and a narrowing is a note.
- **Claude Code's Preview pane** (#37). The viewer works in it: a renderer frame the pane blocks is reopened once as a Blob document in the same sandboxed frame. `projections view --theme claude` colors the page as the pane, and the agent guidance says how to run the viewer from `.claude/launch.json`.
- **Theme seeds** (#28). An app that shows the viewer in its own browser pane can color it as itself: `projections view --theme SEED` (or `view show`) takes a built-in seed's name, inline JSON or a file, and puts it in the link as `?theme=`. The seed is validated, and lives only in the link.
- **Named viewers and a projection menu** (#9). One viewer server shows up to 32 independent named viewers side by side: `--viewer NAME`, and `viewer` on the agent tools and the Copilot canvas. The viewer's title is a menu of the repository's projections, so the person can switch what it shows.

### New built-ins

- `rails-schema` and `rails-routes` extractors (#21).
- `github-agentic-workflows` extractor and the `agentic-workflows/v0` vocabulary (#29), the `agentic-workflows` comparator file (#30), and the `agentic-workflows` renderer, now the extractor's default (#31).

### Viewer and hosts

- Named viewers, and the projection menu in the title (#9).
- A stable viewer URL, `--port` on `view show`, and a 404 page for the bare port that says how to get the full link without revealing it (#17).
- The viewer works framed by a page that isn't a secure context, such as plain http or a custom scheme: page IDs and the engine's hashing no longer need one (#17). Chrome still refuses to load loopback in a frame of a plain-http page on another host (its Local Network Access checks), so such a pane can't show the viewer.
- When no page counts as open, `current_view` says what the viewer saw in the last 10 minutes: a page that never loaded its script or stopped asking, or requests without the token or for a non-loopback host (#17).
- `projections view screenshot --page` captures the viewer's own page, header and toolbar included, without counting as the person's page (#17).
- Claude Code's Preview pane: blocked renderer frames reopen as Blob documents, `--theme claude`, and `.claude/launch.json` guidance (#37).
- Theme seeds for apps that show the viewer in their own pane (#28).
- The `api` renderer lists changed rows first when a large API doesn't fit (#12).

### Authoring

- `projections explore --sweep` ranks projections by signal (rare, steady, noisy, quiet) and says which are likely noise (#22).
- `projections check` warns when a custom extractor's `data` holds churn-prone fields: counts, lists of things elsewhere, or line positions (#22).
- Misplaced evidence fields (`line`, `column`, `file`, `path`…) fail with a message saying where they go (#22).
- `bookmark run` takes `--definition-revision`, and compares bookmarks saved before their projection existed with the working tree's definition, saying so. The agent `compare` tool takes `definitionRevision` (#7).
- In the GitHub Copilot app, agent guidance shows projections in the Projections canvas (#8).

### Platform

- **Windows**: a bare `python3` or `python` in an extractor or prepare command outside a container runs the machine's Python 3 (see [Behaviour changes](#behaviour-changes)), so `init --language python` and `django-schema` work with a python.org install. `doctor` uses the same resolution, and Windows runs in CI (#5).
- Headless browser launches (`--png`, `check`, the `screenshot` tool, sweep thumbnails) are staggered across processes and retried once if the OS aborts one, and `check` and the Inspector service reuse a browser across renders. This avoids macOS's "quit unexpectedly" crashes under parallel runs (#20).

### Fixes

- A renderer edit written right after another, such as a formatter's or an agent's consecutive edits, is served instead of leaving old source on screen (#10).
- `bookmark run` no longer fails on bookmarks older than their projection, and its error suggests only an option that would work (#7).

## v0.1.0

The first release.
