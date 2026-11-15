---
description: "Two Terraform plans of a database migration, for the gallery's infrastructure image"
---

# Encrypt the database

The [gallery](../../../../docs/gallery.md#infrastructure)'s infrastructure
image.

`terraform show -json` plans from the
[`terraform-infrastructure`](../../../../docs/builtins/extractors/terraform-infrastructure.md)
extractor's AWS fixtures, without the network, IAM, compute and monitoring
resources: the database is replaced to encrypt its storage, its replica, DNS
record and connection parameter update, a Secrets Manager secret arrives and the
bastion is destroyed. The extractor reads `plan.json` (`planJsonPath`); nothing
runs. `node tools/scripts/readme-images.mjs --only infrastructure` commits
`before` and `after` as two revisions and draws the images.
