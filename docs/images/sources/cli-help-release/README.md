---
description: "A command line's help before and after a release, for the gallery's text diff image"
---

# CLI help release

The [gallery](../../../../docs/gallery.md#text)'s text diff image.

`cli.mjs` prints the help of a made-up `ship` command. The
[`command-output`](../../../../docs/builtins/extractors/command-output.md)
extractor runs it at both revisions and compares what it prints.
`node tools/scripts/readme-images.mjs --only text-diff` commits `before` and
`after` as two revisions and draws the images.
