---
description: "The projections CLI: one native executable on the Engine"
icon: terminal
---

# projections CLI

The native Rust command line and the Inspector backend, built on the shared
[Engine](../engine/README.md). `npm run build` produces one self-contained
executable, `packages/cli/dist/projections`, that embeds the browser client, the
renderer bundles, the default comparator, the rules interpreter and the
extractor helpers (see [scripts/build.mjs](scripts/build.mjs)). It is released
on GitHub, never published to npm: see
[Install the CLI](../../docs/setup/install.md) and the
[CLI reference](../../docs/reference/cli.md).

`src/` is the CLI and its backend, `templates/` what `projections init`
scaffolds, and `browser/` its browser suites.
`npm test --workspace @githubnext/projections-cli` runs
`cargo test -p projections-cli` and the Node tests; `npm run test:installed`,
`test:gh`, `test:binary` and `test:container` (from the workspace root) cover
installation.
