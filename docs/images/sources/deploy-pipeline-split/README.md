---
description: "A GitHub Actions workflow before and after it gains end-to-end tests and a staged deploy, for the gallery's DAG image"
---

# Deploy pipeline split

The [gallery](../../../../docs/gallery.md#pipeline)'s pipeline (DAG) image. The
workflow is the projected project, not one to copy: to run Projections in CI,
see [`examples/ci`](../../../../examples/ci/README.md).

`ci.yml`: one `deploy` job after `build` becomes `e2e` and `deploy-staging`,
both gating `deploy-production`. The
[`github-actions-jobs`](../../../../docs/builtins/extractors/github-actions-jobs.md)
extractor reads it; nothing runs.
`node tools/scripts/readme-images.mjs --only dag` commits `before` and `after`
as two revisions and draws the images.
