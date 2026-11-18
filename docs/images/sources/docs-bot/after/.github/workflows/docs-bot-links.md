---
description: Checks the documentation's links and comments with the broken ones.
on:
  workflow_dispatch:
permissions:
  contents: read
  actions: read
timeout-minutes: 45
max-ai-credits: 1k
network:
  allowed:
    - defaults
    - python
    - files.pythonhosted.org
    - linkcheck.example.net
skills:
  - skills/check-links
imports:
  - shared/docs-common.md
tools:
  bash: true
  github:
    toolsets: [repos, actions]
safe-outputs:
  add-comment:
    max: 1
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: make docs
---

# Link check

Run `make linkcheck` and compare the broken links with the last run.
