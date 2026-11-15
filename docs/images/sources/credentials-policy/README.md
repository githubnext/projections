---
description: "A Tetragon credentials policy before and after it starts enforcing, for the gallery's runtime policy image"
---

# Credentials policy

The [gallery](../../../../docs/gallery.md#runtime-security-policy)'s runtime
policy image.

A Tetragon `TracingPolicy` that watches reads of credentials, from the
[`tetragon-policies`](../../../../docs/builtins/extractors/tetragon-policies.md)
extractor's test fixtures. In `after`, it kills `curl` and `wget` when they read
the service account token, widens from `payments` workloads to `payments` and
`checkout`, and stops watching `security_mmap_file`. The
[runtime policy comparator](../../../../packages/comparators/runtime-policy/README.md)
says what each change means for security.
`node tools/scripts/readme-images.mjs --only runtime-policy` commits `before`
and `after` as two revisions and draws the images.
