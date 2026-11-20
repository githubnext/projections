# Set up Projections

Use this guide when you're a coding agent setting up Projections in someone
else's repository. If you're working on Projections itself, head to
[AGENTS.md](AGENTS.md) instead.

Projections maps the systems inside a codebase—dependencies, schemas,
infrastructure, service wiring, and similar structures—and shows how a change
reshapes them. You run the work through the `projections` CLI while the person
watches the results in the viewer, a local page that you drive.

## Steps

1. **Install the CLI** if `projections --version` doesn't already print a
   version. Follow [docs/agents/install.md](docs/agents/install.md) and verify
   the download as instructed.
2. **Explore the repository.** Run `projections help agents explore` from the
   repository root and follow its instructions. It identifies the projections
   that fit the codebase, tries them against recent pull requests, and helps you
   adopt the ones the person wants to keep.
3. **Create custom projections for repository-specific systems.** When the
   codebase has something unique that built-ins don't cover, run
   `projections help agents create-projection` and follow its steps. Running
   `projections init` also writes a skill for you at
   `.agents/skills/projections/SKILL.md` that covers the full authoring loop.
4. **Show results in the viewer.** Run `projections view show -p <id>`, or call
   the `open_projection` tool when running `projections mcp`. Open the viewer in
   your in-app browser when you have one, or pass `--open` to launch a
   standalone browser. If the person asks to "open it in the inspector", this
   viewer is what they mean. In the GitHub Copilot app, prefer the Projections
   canvas over a browser tab because the canvas matches the app's theme—run
   `projections canvas install` once, then open the `projections` canvas.
5. **Wait to touch CI until asked.** When they want CI integration, run
   `projections help agents ci` to propose where Projections fits in their
   workflows. Never edit CI files without their go-ahead.

Any code that comes from the repository itself (custom extractors and some
built-in ones) only runs when you pass `--trust`. Review what it will execute
and ask the person before trusting it.

## More

- [Quick start](docs/setup/quick-start.md) and
  [first projection](docs/setup/first-projection.md) walk through the same flow
  for people.
- [How it works](docs/guides/how-it-works.md) explains extractors, comparators,
  and renderers.
- [Agent tools](docs/runner/agent-tools.md) covers the MCP server, the viewer,
  and their tools.
- [Agent skills](docs/setup/agent-skills.md) lists which agents read which
  skills directory.
- [Security](docs/guides/security.md) explains what runs, where it runs, and
  what access it has.
- `projections help` and `projections help authoring` provide the CLI's built-in
  reference.
