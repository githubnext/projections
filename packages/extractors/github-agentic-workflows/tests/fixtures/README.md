# Fixtures

`node scripts/fixtures.mjs --gh-aw <gh-aw binary>` writes these (see the
[package README](../../README.md#fixtures)). Lock files keep only their first
three lines, the header gh-aw writes and the extractor reads.

- `public/`: real workflows, verbatim, with their imports and lock files:
  `firewall`, `daily-documentation-diagram` and their shared imports from
  [github/gh-aw](https://github.com/github/gh-aw) at
  `789cc9c2da60fca3b4e0396591c7179be3b5d9eb` (v1.3.0), and `link-checker` from
  [githubnext/agentics](https://github.com/githubnext/agentics) at
  `139fa09ef17cde4135e696ff8e7af09bc5ddfa6e`, compiled there by gh-aw v0.93.3.
  Both repositories are MIT licensed by GitHub
  ([gh-aw](https://github.com/github/gh-aw/blob/v1.3.0/LICENSE),
  [agentics](https://github.com/githubnext/agentics/blob/139fa09ef17cde4135e696ff8e7af09bc5ddfa6e/LICENSE)).
- `repo-ask/`: agentics' `workflows/repo-ask.md` (before), and a pull request
  that widens its network allowlist and GitHub toolsets, raises its comment limit
  and timeout and adds an issue output (after).
- `docs-bot/`: a synthetic group of documentation workflows (`docs-bot` dispatching
  `docs-bot-links` and `docs-bot-examples`, with shared `check-*` guardrail
  skills) and an unrelated `issue-triage`. The after revision adds a repository,
  a toolset and a cross-repository pull request output to `docs-bot`, lowers its
  `min-integrity`, raises its AI credits and issue limit, and drops its
  `check-links` skill; opens `docs-bot-links`'s bash and network;
  narrows `docs-bot-examples`; adds `docs-bot-digest`; and edits `issue-triage`
  without recompiling it, so its lock is stale.

`repo-ask` and `docs-bot` are compiled by gh-aw v1.3.0, built from the release tag.
