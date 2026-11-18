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
engine:
  id: copilot
  model: gpt-5
timeout-minutes: 30
max-ai-credits: 2k
max-daily-ai-credits: 10k
concurrency:
  group: docs-bot
network:
  allowed:
    - defaults
    - python
skills:
  - skills/check-style
  - skills/check-links
imports:
  - shared/docs-common.md
tools:
  github:
    toolsets: [repos, actions]
    allowed-repos: ["${{ github.repository }}"]
    min-integrity: approved
safe-outputs:
  create-issue:
    title-prefix: "[docs-bot] "
    labels: [documentation]
    max: 1
  dispatch-workflow:
    workflows: [docs-bot-links, docs-bot-examples]
    max: 2
---

# Docs bot

Plan this week's documentation run for ${{ github.repository }}: dispatch the
link and example workflows, then summarize their results in one issue.
