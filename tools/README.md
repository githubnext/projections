---
description: The repository's own tooling, built and run only here; no release ships it
icon: wrench
---

# Repository tooling

What builds, checks and demonstrates the product but never ships with it:

- `cli/`: the `tools` command line for contributors and agents
  (`npm run tools -- --help`).
- `scripts/`: build, check, documentation and release scripts.
- `storybook/`: the renderer and host Storybook.
- `gh-projections/`: the source-checkout `gh` extension launcher.

Shipped code in `packages/` never imports anything here at run time; see
[CONTRIBUTING.md](../CONTRIBUTING.md#layout).
