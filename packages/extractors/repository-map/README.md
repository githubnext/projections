---
description: "The revision's files as a sized directory tree (graph/v0)"
---

# Repository map — `graph/v0`

Maps the captured revision's tracked and untracked nonignored files as a
directory/file hierarchy, presented by the `file-packing` renderer: every file a
circle sized by its bytes, inside its folders' circles. `inputs.include` and
`inputs.exclude` are glob arrays (`*`, `**` and `?`); by default every file is
mapped. File entities record their `path` and `size` in bytes: the size of the
revision's blob (a symlink's is its target path), so the same revision always
maps the same way. With `inputs.lines: true` each text file also records `lines`
(binary files, with a NUL byte in their first 8,000 bytes as Git decides, record
none). Symlinks are represented without being followed, and directories carry no
size; renderers aggregate it. The state is limited to 10,000 entities; narrow
larger repositories with globs rather than relying on truncation.

Reading the file list executes nothing and does not require `--trust`. This is
one of the two default projections the CLI uses when a revision has no authored
definitions.
