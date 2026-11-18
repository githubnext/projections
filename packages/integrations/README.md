---
description: Projections inside other products, one thin adapter per host product
icon: plug
---

# Integrations

Each folder here runs Projections inside another product, whose extension API
owns its lifecycle:

- [`vscode`](vscode/README.md): the VS Code extension.
- [`github-action`](github-action/README.md): the GitHub Action's scripts (its
  `action.yml` stays at the repository root, where `uses:` finds it).
- [`copilot-canvas`](copilot-canvas/README.md): the viewer as a canvas in the
  GitHub Copilot app.

## What belongs here

- **One folder per host product, named after it** (`jetbrains`, `zed`, `neovim`,
  `gitlab-ci`, `claude-code`), not after what it does.
- **A thin adapter over the CLI and host packages.** An integration starts the
  CLI (`projections serve --stdio`, `projections view`, `projections compare`)
  and, where it shows projections, mounts the host UI
  ([`packages/host`](../host/README.md)); it translates the product's commands,
  views, settings and lifecycle into theirs.

## What doesn't

- **Projections semantics.** Extraction, comparison, validation and anything
  that decides what a projection says belong in the CLI and the Engine, so every
  integration agrees.
- **UI a second product could use.** A view, control or theme belongs in
  `packages/host`; the integration only mounts it.
- **The CLI itself** ([`packages/cli`](../cli/README.md)): it is the runtime
  every integration wraps, not an integration.
- **Repository tooling** (`tools/`): an integration ships to users.
