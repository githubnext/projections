Writes the Projections canvas extension to
.github/extensions/projections/extension.mjs, where the GitHub Copilot app (and
Copilot CLI) load it for this repository. Its canvas shows the viewer
(projections view) in the app's side panel, and its actions are the
open_projection, current_view, screenshot and refresh tools. It runs the
projections CLI on PATH, or PROJECTIONS_CLI. Commit it to share it with the
repository's contributors. An existing file is replaced only with --force.
