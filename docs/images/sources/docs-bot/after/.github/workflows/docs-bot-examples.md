---
description: Runs the documentation's code examples and proposes fixes as a draft pull request.
on:
  workflow_dispatch:
permissions:
  contents: read
timeout-minutes: 30
network:
  allowed:
    - defaults
skills:
  - skills/check-style
imports:
  - shared/docs-common.md
tools:
  bash: ["python3", "make examples"]
  edit:
safe-outputs:
  create-pull-request:
    title-prefix: "[examples] "
    draft: true
---

# Examples

Run the code examples with `make examples` and propose fixes for the ones that
fail.
