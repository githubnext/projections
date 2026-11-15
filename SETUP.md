# Set up Projections

This guide is for coding agents setting up Projections for someone, in their
repository. To work on Projections itself, read [AGENTS.md](AGENTS.md) instead.

Projections shows the systems in a codebase (dependencies, schemas,
infrastructure, service wiring and the like) and how a change reshapes them. You
do the work with the `projections` CLI; the person watches the results in the
viewer, a page on their machine that you drive.

## Steps

1. **Install the CLI**, unless `projections --version` already prints a version:
   follow [docs/agents/install.md](docs/agents/install.md). Verify the download
   as it says.
2. **Explore**: in the person's repository, run
   `projections help agents explore` and follow what it prints. It finds the
   projections that apply there, tries them on recent pull requests, and adopts
   the ones the person picks.
3. **Create projections specific to the codebase**, for something only it has:
   run `projections help agents create-projection` and follow what it prints.
   `projections init` writes a skill for you
   (`.agents/skills/projections/SKILL.md`) with the whole authoring loop.
4. **Show them** to the person in the viewer: `projections view show -p <id>`
   (or the `open_projection` tool when you run `projections mcp`). When they ask
   to "open it in the inspector", they mean this viewer.
5. **CI only when asked**: `projections help agents ci` proposes where
   Projections goes in their workflows; never change CI without their agreement.

Repository code (custom and some built-in extractors) runs only with `--trust`:
review it, and ask the person, before trusting it.

## More

- [Quick start](docs/setup/quick-start.md) and
  [first projection](docs/setup/first-projection.md): the same path, for people.
- [How it works](docs/guides/how-it-works.md): extractors, comparators and
  renderers.
- [Agent tools](docs/runner/agent-tools.md): the MCP server, the viewer and
  their tools.
- [Agent skills](docs/setup/agent-skills.md): which agents read which skills
  directory.
- [Security](docs/guides/security.md): what runs, where, and with what access.
- `projections help` and `projections help authoring`: the CLI's own reference.
