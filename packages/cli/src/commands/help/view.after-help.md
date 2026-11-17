```text
Examples:
  projections view --open                          the suggested change, in the default browser
  projections view -p service-map --choice branch  this branch's changes
  projections view -p api --before v1 --after HEAD --mode side-by-side
  projections view --trust                         run the projections' own code; replaces an untrusted viewer
  projections view show --viewer api -p api        a second page beside the first, showing another projection
  projections view stop                            stop the viewer running for this repository
  projections view --definition-revision working-tree --before v1 --after v2   uncommitted projection code on history
```

The design is described in docs/design/agent-viewer.md.
