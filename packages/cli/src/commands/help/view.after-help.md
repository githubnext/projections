```text
Examples:
  projections view --open                          the suggested change, in the default browser
  projections view -p service-map --choice branch  this branch's changes
  projections view -p api --before v1 --after HEAD --mode side-by-side
  projections view --trust                         run the projections' own code; replaces an untrusted viewer
  projections view show --viewer api -p api        a second page beside the first, showing another projection
  projections view show --port 47470 -p api        start it on a fixed port (refused while it runs on another)
  projections view show --theme '{"light": {"background": "#f7f6f3", "border": "#e4e2dd"}}'
                                                   a link whose page takes a harness's colors (or --theme theme.json)
  projections view --port 47470 --theme claude    for Claude Code's Preview pane: a fixed port, Claude's colors
  projections view screenshot --page --out view.png  the viewer's page, header and toolbar included
  projections view stop                            stop the viewer running for this repository
  projections view stop --rotate                   and forget its link: the next viewer has a new token
  projections view --definition-revision working-tree --before v1 --after v2   uncommitted projection code on history
```

The design is described in docs/design/agent-viewer.md.
