---
description: "A group of gh-aw documentation workflows before and after a pull request widens them, for the gallery's agentic workflows image"
---

# Docs bot

The [gallery](../../../../docs/gallery.md#agentic-workflows)'s agentic workflows
image.

A group of invented [GitHub Agentic Workflows](https://github.com/github/gh-aw),
from the
[`github-agentic-workflows`](../../../../docs/builtins/extractors/github-agentic-workflows.md)
extractor's test fixtures: `docs-bot` dispatches `docs-bot-links` and
`docs-bot-examples`, which load shared `check-*` guardrail skills. In `after`,
`docs-bot` reaches another repository, gains a toolset, a lower `min-integrity`,
a cross-repository pull request output and more AI credits, and stops loading
`check-links`; `docs-bot-links` opens bash and its network; and `issue-triage`
changes without being recompiled. The
[`agentic-workflows` comparator](../../../../packages/comparators/agentic-workflows/README.md)
says in which direction each change moves what the agents may do. Lock files
keep only the header gh-aw v1.3.0 wrote, which is all the extractor reads.
`node tools/scripts/readme-images.mjs --only agentic-workflows` commits `before`
and `after` as two revisions and draws the images.
