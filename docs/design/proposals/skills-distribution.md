# Proposal: distributing Projections' agent skills

Status: **proposal**. Nothing here is implemented beyond what [Today](#today)
describes.

Agent skills are part of the product, like the CLI and the npm package: a coding
agent in someone else's repository needs the authoring guide that matches the
Projections they have installed, without cloning this repository. This page
compares the ways skills reach people and recommends one plan.

## Today

- **One consumer skill, shipped in the CLI.** `projections init` writes
  `projections/SKILL.md` in `.agents/skills/` (or the skills directory that
  already holds it, an existing `.claude/skills/` or `.github/skills/`, or
  `--skills-dir`), `--claude` links or copies it into `.claude/skills/` for
  Claude Code, and `projections help authoring` prints the same guide. Its
  template is
  [`packages/cli/templates/SKILL.md`](../../../packages/cli/templates/SKILL.md);
  the CLI fills in the schemas, vocabularies and built-in renderers it actually
  supports, so the skill always matches the binary. The skill records the CLI's
  version in `metadata.projections-version`; every run of `init` updates a skill
  that has it, and `projections doctor` warns when it is from another version.
  [Agent skills](../../setup/agent-skills.md) has the details and which agents
  read which directory, from their vendors' documentation.
  [Create a projection](../../agents/create-projection.md) is generated from it.
- **Contributor skills** for working on Projections itself live in
  [`.agents/skills/`](../../../.agents/skills/) (today,
  `design-projection-animation`), marked `metadata.internal: "true"` so the
  `skills` CLI doesn't offer them to consumers. The repository's command line,
  [`tools`](../../../tools/cli/README.md#agents), generates skills for its own
  commands (`npm run tools -- skills add`) and registers its MCP server
  (`mcp add`); that serves contributors, not consumers.
- **Gaps.** People can't get the skill before they install the CLI, and the
  skill (about 570 lines) is over the open standard's advice to keep `SKILL.md`
  under 500 lines and move detail to referenced files
  ([specification](https://agentskills.io/specification#progressive-disclosure)).

## The channels

| Channel                                                                                                                                                                              | How it works                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Versioning and updates                                                                                                                                                                                                                                                                                                                 | Fit                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **The `projections` CLI** (`init`, a future `projections skills`)                                                                                                                    | Writes the skill the installed binary generates                                                                                                                                                                                                                                                                                                                                                                                                                    | Exact: content comes from the binary. Updates when the person reruns it after upgrading                                                                                                                                                                                                                                                | The source of truth; already works                                   |
| **[`gh skill`](https://cli.github.com/manual/gh_skill_install)** (GitHub CLI 2.90+, preview)                                                                                         | `gh skill install OWNER/REPO SKILL` finds `skills/*/SKILL.md` (also under a prefix) and installs per agent, project or user scope                                                                                                                                                                                                                                                                                                                                  | Resolves the **latest tagged release**, else the default branch; `@TAG`, `--pin`; `gh skill update` reads provenance it writes into the frontmatter (`metadata.github-*`)                                                                                                                                                              | Good: our release tags are CLI releases                              |
| **[Vercel's `skills` CLI](https://github.com/vercel-labs/skills)** (`npx skills add owner/repo`)                                                                                     | Discovers `skills/` and the agent directories (`.agents/skills/`, `.claude/skills/`, …; [not `.github/skills/`](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md#skill-discovery)), installs into `.agents/skills/` and links into each selected agent's directory (Copilot, Codex, Cursor and Gemini CLI read `.agents/skills/`; Claude Code `.claude/skills/`) ([agents](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)) | Default branch unless `owner/repo@v1.2.3`; `skills-lock.json` holds a content hash; `skills check` and `skills update`                                                                                                                                                                                                                 | Good, same layout as `gh skill`                                      |
| **[skills.sh](https://skills.sh/docs)**                                                                                                                                              | A leaderboard ranked by the `skills` CLI's anonymous install telemetry; nothing to submit                                                                                                                                                                                                                                                                                                                                                                          | n/a                                                                                                                                                                                                                                                                                                                                    | Free once the layout above exists                                    |
| **Skills in npm packages**                                                                                                                                                           | `npx skills experimental_sync` links a dependency's root `SKILL.md`, `skills/<name>/` or `dist/skills/<name>/` into the project and relinks on update ([reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#skills-experimental_sync), [RFC](https://github.com/vercel-labs/skills/issues/2323))                                                                                                                                           | Moves with the package version                                                                                                                                                                                                                                                                                                         | Later, for renderer authors; experimental                            |
| **Agent plugins** ([Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating), [Claude Code](https://code.claude.com/docs/en/plugins)) | A `plugin.json` with `skills/` and an MCP configuration; [Agent Plugins 1.0](https://agent-plugins.org/plugin-authors) is the portable format. Installed from a marketplace (`.github/plugin/marketplace.json` or `.claude-plugin/marketplace.json`) or straight from `OWNER/REPO[:PATH]`                                                                                                                                                                          | Plugin `version`; `copilot plugin update`, Claude's `/plugin marketplace update`; [auto-update is opt-in](https://code.claude.com/docs/en/plugins/host-marketplace#keep-users-up-to-date) except Copilot's built-in marketplace ([reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)) | Later: one install gives the skill **and** `projections mcp`'s tools |
| **MCP-served docs**                                                                                                                                                                  | `projections mcp` already sends `instructions` and the tools. MCP also defines [resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources) and [prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)                                                                                                                                                                                                       | Exact: served by the binary                                                                                                                                                                                                                                                                                                            | Next: cheap, and reaches agents with no skill support                |
| **[Agent Skills standard](https://agentskills.io/specification)**                                                                                                                    | `name` matches the directory; `description` ≤ 1024 characters; optional `license`, `compatibility`, `metadata` (string map); `references/` loaded on demand                                                                                                                                                                                                                                                                                                        | `metadata` can carry a version                                                                                                                                                                                                                                                                                                         | The format every channel above reads                                 |

`gh skill` and `npx skills` both find a skill at `skills/<name>/SKILL.md` in a
public repository. `gh skill` skips hidden directories; the `skills` CLI also
reads `.agents/skills/` and `.claude/skills/` but skips skills marked
`metadata.internal`, so contributor skills stay out of consumers' installs.

## Recommendation

**The CLI stays the source of truth; the public repository publishes the same
skill, generated, where skill managers look.**

1. **Where skills live.** The consumer skill is generated into
   `skills/projections/SKILL.md` at the repository root from
   `projections help authoring` by `npm run docs:generate`, and
   `npm run docs:check` fails when it is stale, as for
   [Create a projection](../../agents/create-projection.md). The template stays
   in `packages/cli/templates/`. Contributor skills stay in `.agents/skills/`,
   marked internal.
2. **What consumers run.** Normally nothing new: `projections init` writes the
   skill. Before installing the CLI, or to manage skills with other tools:
   `gh skill install githubnext/projections projections` or
   `npx skills add githubnext/projections`. Both work from the layout in step 1.
3. **Versions stay in sync** because the published copy is generated from the
   CLI at the same commit, and release tags are CLI releases, so `gh skill`'s
   default (latest release) matches the latest CLI. The skill records its
   version in `metadata.projections-version`, and its first step tells the agent
   to prefer `projections help authoring` when the installed CLI is another
   version.
4. **Updates reach consumers** through `projections doctor`, which warns when a
   project's skill was written by another CLI version and names the command that
   refreshes it (`projections init --skill`, or a `projections skills update`);
   people who installed with `gh skill` or `npx skills` use those tools'
   `update`.

### Now

Done: `implement-projection` folded into the `projections` skill,
`design-projection-animation` moved here as a contributor skill, and `init`
writes to `.agents/skills/` by default, records the skill's version, keeps it up
to date and adds it for Claude Code with `--claude`.

Next, before the repository is public:

- Generate `skills/projections/SKILL.md` and gate it with `docs:check`.
- Document the three install routes on
  [Build your first projection](../../setup/first-projection.md).

### Later

- Serve the authoring guide and agent prompts from `projections mcp` as
  resources and prompts.
- Split the skill to fit the standard: a short `SKILL.md` that routes to
  `references/` (extractor, renderer, comparator), so `init` writes a directory.
- Publish an Agent Plugins 1.0 plugin (the skill plus an `mcp.json` running
  `projections mcp`) and list it in a marketplace once the CLI installs
  publicly.
- Ship a renderer-authoring skill in `@githubnext/projections` when npm skill
  sync is stable.

## Open questions

1. ~~**Default location for `init`.**~~ Decided: `.agents/skills/`, which
   Copilot, Codex, Cursor and Gemini CLI read, with `--claude` for Claude Code
   ([agent skills](../../setup/agent-skills.md)).
2. **One skill or several.** One `projections` entry point routing to
   references, or separate skills (set up, extractor, renderer, comparator) that
   trigger more precisely but cost more description tokens each session?
3. **A `projections skills` command,** or only `init --skill` and `doctor`?
4. **Marketplaces at launch.** List a plugin in GitHub's and Anthropic's
   marketplaces at launch, or wait for demand?
5. **Telemetry.** skills.sh ranks by the `skills` CLI's install telemetry, which
   we don't control. Is that acceptable as the public signal, or should install
   docs lead with `gh skill`?
