---
description: Writes the documentation's weekly digest as a discussion.
on:
  workflow_dispatch:
permissions:
  contents: read
  discussions: read
timeout-minutes: 15
network: defaults
skills:
  - skills/check-style
  - skills/digest-format
tools:
  github:
    toolsets: [discussions]
safe-outputs:
  create-discussion:
    category: documentation
    max: 1
---

# Weekly digest

Summarize this week's link and example results as a discussion.
