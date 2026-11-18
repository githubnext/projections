---
description: Labels new issues and asks for missing details.
on:
  issues:
    types: [opened, reopened]
permissions: read-all
network: defaults
timeout-minutes: 10
tools:
  github:
    toolsets: [issues, labels]
safe-outputs:
  add-labels:
    allowed: [bug, enhancement, question, documentation]
    max: 3
  add-comment:
    max: 1
---

# Issue triage

Read issue #${{ github.event.issue.number }} and label it.
