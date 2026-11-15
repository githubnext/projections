---
description: "An npm workspace before and after a React upgrade, for the gallery's dependencies image"
---

# React 19 upgrade

The [gallery](../../../../docs/gallery.md#dependencies)'s dependencies image.

Three workspaces and their lockfile: React 18 to 19, `moment` replaced by
`date-fns`, `classnames` by `clsx`, and a new `@acme/icons` workspace. The
lockfile is pared down to these packages. The
[`workspace-dependencies`](../../../../docs/builtins/extractors/workspace-dependencies.md)
extractor reads the manifests and `package-lock.json`; nothing runs.
`node tools/scripts/readme-images.mjs --only dependencies` commits `before` and
`after` as two revisions and draws the images.
