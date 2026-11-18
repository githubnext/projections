# Changelog

What changed in each release of Projections. A version's section is the body of its [GitHub release](https://github.com/githubnext/projections/releases), and its release candidates use it too ([release notes](docs/maintainers/releasing.md#release-notes)).

## v0.2.0

Projections 0.2.0 adds built-ins for Rails and makes the agent viewer easier to drive and embed. Read [Behaviour changes](#behaviour-changes) before upgrading.

### Behaviour changes

- **The viewer keeps its URL across restarts** (#17).
  - The token and port are kept per project in the user cache, readable only by you, so a viewer restarted after `view stop`, its idle exit or a reboot serves the same link.
  - `projections view stop --rotate` forgets it: the next viewer gets a new token, and earlier links stop working.
  - `view --port N` and `view show --port N` refuse while the project's viewer runs on another port, and refuse a taken port rather than picking another.
- **The agent `compare` tool applies the viewer's definition to the viewer's pair** (#7). Comparing the pair the viewer shows, or a suggested pair such as a bookmark, without naming revisions now applies the definition the viewer applies (usually the working tree's) instead of the base revision's, so the result matches what's on screen and can differ from before. Pass `definition: base` for the previous choice. Given revisions keep the base/head rule.
- **A bare `python` or `python3` command runs Python 3** (#5). In an extractor's or prepare step's command, the runner tries the name as written, then the other name, then `py -3`, and runs the first that reports Python 3. A `python` that is Python 2 is passed over, and with no Python 3 the command fails. Name a path, such as `.venv/bin/python`, to run an interpreter as written. Inside a container (`--isolation container`), commands run as written.
- **`projections init` may put the agent skill elsewhere** (#22). Among `.agents/skills`, `.claude/skills` and `.github/skills`, it now picks the one holding most of the repository's own skills (the most widely read breaks ties) and says why. `--no-skill` writes none.

### Highlights

- **Rails built-ins** (#21). `rails-schema` reads `db/schema.rb` into the `database` renderer, and `rails-routes` evaluates the routing DSL into the `api` renderer. Both read files only: no Ruby, gems, Rails boot or database, no `--trust`, and every revision of a history.
- **Named viewers and a projection menu** (#9). One viewer server shows up to 32 independent named viewers side by side: `--viewer NAME`, and `viewer` on the agent tools and the Copilot canvas. The viewer's title is a menu of the repository's projections, so the person can switch what it shows.

### New built-ins

- `rails-schema` and `rails-routes` extractors (#21).

### Viewer and hosts

- Named viewers, and the projection menu in the title (#9).
- A stable viewer URL, `--port` on `view show`, and a 404 page for the bare port that says how to get the full link without revealing it (#17).
- The viewer works framed by a page that isn't a secure context, such as plain http or a custom scheme: page IDs and the engine's hashing no longer need one (#17). Chrome still refuses to load loopback in a frame of a plain-http page on another host (its Local Network Access checks), so such a pane can't show the viewer.
- When no page counts as open, `current_view` says what the viewer saw in the last 10 minutes: a page that never loaded its script or stopped asking, or requests without the token or for a non-loopback host (#17).
- `projections view screenshot --page` captures the viewer's own page, header and toolbar included, without counting as the person's page (#17).
- The `api` renderer lists changed rows first when a large API doesn't fit (#12).

### Authoring

- `projections explore --sweep` ranks projections by signal (rare, steady, noisy, quiet) and says which are likely noise (#22).
- `projections check` warns when a custom extractor's `data` holds churn-prone fields: counts, lists of things elsewhere, or line positions (#22).
- Misplaced evidence fields (`line`, `column`, `file`, `path`…) fail with a message saying where they go (#22).
- `bookmark run` takes `--definition-revision`, and compares bookmarks saved before their projection existed with the working tree's definition, saying so. The agent `compare` tool takes `definitionRevision` (#7).
- In the GitHub Copilot app, agent guidance shows projections in the Projections canvas (#8).

### Platform

- **Windows**: a bare `python3` or `python` in an extractor or prepare command outside a container runs the machine's Python 3 (see [Behaviour changes](#behaviour-changes)), so `init --language python` and `django-schema` work with a python.org install. `doctor` uses the same resolution, and Windows runs in CI (#5).

### Fixes

- A renderer edit written right after another, such as a formatter's or an agent's consecutive edits, is served instead of leaving old source on screen (#10).
- `bookmark run` no longer fails on bookmarks older than their projection, and its error suggests only an option that would work (#7).

## v0.1.0

The first release.
