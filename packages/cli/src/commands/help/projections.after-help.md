```text
Examples:
  projections explore                          find the projections that apply here and try them on recent pull requests
  projections init service-map                 make a projection of something only this codebase has
  projections show -p service-map --trust      the working tree, as text (--json, --png FILE)
  projections compare main...HEAD --trust      what this branch changes
```

Repository code (custom and some built-in extractors) runs only with --trust;
review it first. Comparators and renderers run sandboxed. A projection's
toolchain is never installed for you.\
projections help authoring explains how to build a projection; coding agents
load the same guide from the skill projections init writes, in .agents/skills
(projections init --claude adds it for Claude Code).
