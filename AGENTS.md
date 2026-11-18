# Projections

This file is for agents working on Projections itself. To set up Projections in
someone's repository, follow [SETUP.md](SETUP.md) instead.

This repository must build and run from a fresh clone, without credentials,
private repositories or files outside it; `npm run check:boundaries` enforces
it.

Ask the repository rather than this file: `tools` is its command line for
agents. Here `tools` means `npm run tools --`, run from the repository root
(`npx tools` works too). If `tools link` has put `projections-tools` on `PATH`,
that runs the same commands from anywhere, using the checkout you are in.

- Agentic contributions are welcome everywhere in this repository _except_ for
  root README prose. That must be human authored. If root README changes are
  needed, ask the human user to provide verbatim content or edit the file.
- Start every session with `tools context`: purpose, areas, toolchains, git
  state, changed packages and the invariants (kept in
  CONTRIBUTING.md#invariants).
- Find your way with `tools map`, `tools explain <path>` and
  `tools docs search <words>`.
- Everything that ships, or that something shipped depends on, lives in
  `packages/`; repository infrastructure (the `tools` CLI, `tools/scripts/`,
  `tools/storybook/`, workflows) stays outside it. Shipped code never imports
  `tools/` at run time.
- Verify cheapest first, and broaden only once the narrower step passes: builds
  and test runs are slow and memory-hungry, and on a busy machine they wait for
  a slot, so don't spend one to find a type or compile error.
  1. `tools check --fast`: format, lint, `cargo check` and typecheck of only
     what changed, and the repository rules. It builds and tests nothing.
  2. `tools build <workspace>` when a test needs built output: that workspace
     and what it depends on, rebuilding only what is out of date. Not
     `npm run build`, which rebuilds every workspace, the release CLI and
     Storybook included.
  3. The narrowest tests: `tools test <workspace or crate>`, with
     `--filter <name>` for the tests you touched (and `--browser <project>` for
     one browser project).
  4. `tools check --affected` and `tools test --affected`, then the full
     `tools check` before handing off.

  Each reports `{file, line, message}` problems and what to run next.

- Run `npm ci` only in a fresh checkout or when `tools doctor` says
  `node_modules` doesn't match the lockfile.
- Browser suites run only as `tools test <workspace> --browser <project>`: one
  project at a time, never in parallel.
- Never edit generated files by hand: `tools explain` says whether a file is
  generated, `tools generated` lists them and `tools fix` regenerates them.
- Install packages only through the committed `.npmrc` registry; `tools doctor`
  checks it.
- `tools --help` and `tools --llms` describe every command.
- Report friction with `tools feedback "<summary>"`. It drafts an issue; only
  `--submit`, with the person's agreement, files it.
