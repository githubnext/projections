---
name: Docs bot
description: Weekly documentation run that checks links, runs the code examples and files a summary issue.
on:
  schedule: weekly on monday
  workflow_dispatch:
permissions:
  contents: read
  actions: read
  issues: read
  pull-requests: read
engine:
  id: copilot
  model: gpt-5
timeout-minutes: 30
max-ai-credits: 5k
max-daily-ai-credits: 10k
concurrency:
  group: docs-bot
network:
  allowed:
    - defaults
    - python
skills:
  - skills/check-style
imports:
  - shared/docs-common.md
tools:
  github:
    toolsets: [repos, actions, pull_requests]
    allowed-repos: ["${{ github.repository }}", "octo-org/docs-site"]
    min-integrity: unapproved
safe-outputs:
  create-issue:
    title-prefix: "[docs-bot] "
    labels: [documentation]
    max: 3
  create-pull-request:
    title-prefix: "[docs-site] "
    target-repo: octo-org/docs-site
  dispatch-workflow:
    workflows: [docs-bot-links, docs-bot-examples, docs-bot-digest]
    max: 3
---

# Docs bot

Plan this week's documentation run for ${{ github.repository }}: dispatch the
link and example workflows, then summarize their results in one issue, and
propose fixes to octo-org/docs-site.
