# Proposal: distributing Projections' agent skills

Status: **proposal**. Nothing here is implemented yet beyond what
[Today](#today) describes.

Agent skills are part of the product, just like the CLI and the npm package. A
coding agent working in someone else's repository needs an authoring guide that
matches the version of Projections they have installed, without having to clone
this repository. This proposal compares the distribution channels available and
recommends a plan.

## Today

- **One consumer skill, shipped in the CLI.** `projections init` writes
  `projections/SKILL.md` into `.agents/skills/` (or reuses an existing
  `.claude/skills/` or `.github/skills/` directory, or whatever `--skills-dir`
  specifies). Passing `--claude` links or copies it into `.claude/skills/` for
  Claude Code, and `projections help authoring` prints the exact same guide. The
  template lives at
  [`packages/cli/templates/SKILL.md`](../../../packages/cli/templates/SKILL.md),
  and the CLI fills in the schemas, vocabularies, and built-in renderers it
  actually supports so the skill always matches the binary. The skill records
  that version in `metadata.projections-version`: every `init` run refreshes a
  skill carrying that field, and `projections doctor` warns if it drifts from
  the installed CLI. See [Agent skills](../../setup/agent-skills.md) for the
  full vendor directory table;
  [Create a projection](../../agents/create-projection.md) is generated from the
  same template.
- **Contributor skills.** Skills for working on Projections itself live in
  [`.agents/skills/`](../../../.agents/skills/) (currently
  `design-projection-animation`) and are marked `metadata.internal: "true"` so
  the `skills` CLI won't offer them to consumers. The repo's own
  [`tools`](../../../tools/cli/README.md#agents) CLI generates skills for its
  commands (`npm run tools -- skills add`) and registers its MCP server
  (`mcp add`), both aimed at contributors rather than consumers.
- **Gaps.** Right now, people can't install the skill before installing the CLI.
  At about 570 lines, `SKILL.md` also exceeds the open standard's guidance to
  keep it under 500 lines and move detail into referenced files
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

Both `gh skill` and `npx skills` look for `skills/<name>/SKILL.md` in a public
repository. `gh skill` ignores hidden directories, while the `skills` CLI also
scans `.agents/skills/` and `.claude/skills/` but skips anything marked
`metadata.internal`, keeping contributor skills out of consumer installs.

## Recommendation

**Keep the CLI as the source of truth, and publish the same generated skill in
the public repository where skill managers look for it.**

1. **Where skills live.** `npm run docs:generate` generates the consumer skill
   into `skills/projections/SKILL.md` at the repository root from
   `projections help authoring`, and `npm run docs:check` fails if it falls out
   of date (just like [Create a projection](../../agents/create-projection.md)).
   The template stays in `packages/cli/templates/`, and contributor skills stay
   in `.agents/skills/` marked internal.
2. **What consumers run.** Most people don't need to do anything new:
   `projections init` already writes the skill. If they want the skill before
   installing the CLI — or prefer to manage skills with a dedicated tool — they
   can run `gh skill install githubnext/projections projections` or
   `npx skills add githubnext/projections`, both of which work automatically
   with the layout above.
3. **Keeping versions in sync.** Because the published copy is generated from
   the CLI at the same commit and release tags correspond to CLI releases,
   `gh skill`'s default (latest release) tracks the latest CLI. The skill stores
   its version in `metadata.projections-version`, and its first step tells the
   agent to prefer `projections help authoring` whenever the installed CLI is a
   different version.
4. **Delivering updates.** `projections doctor` warns when a project's skill
   comes from a different CLI version and prints the refresh command
   (`projections init --skill`, or a future `projections skills update`). Users
   who installed via `gh skill` or `npx skills` can run those tools' own
   `update` commands.

### Now

Already done: `implement-projection` has been folded into the `projections`
skill, `design-projection-animation` lives here as a contributor skill, and
`init` writes to `.agents/skills/` by default, stamps the skill's version, keeps
it refreshed, and supports `--claude` for Claude Code.

Next, before making the repository public:

- Generate `skills/projections/SKILL.md` and gate it in CI with `docs:check`.
- Document all three install paths on
  [Build your first projection](../../setup/first-projection.md).

### Later

- Expose the authoring guide and agent prompts as MCP resources and prompts from
  `projections mcp`.
- Trim `SKILL.md` to fit the standard by turning it into a short router that
  points to `references/` (extractor, renderer, comparator), with `init` writing
  the directory.
- Publish an Agent Plugins 1.0 plugin (bundling the skill with an `mcp.json`
  that runs `projections mcp`) and list it in a marketplace once the CLI is
  publicly installable.
- Ship a renderer-authoring skill inside `@githubnext/projections` once npm
  skill sync stabilizes.

## Open questions

1. ~~**Default location for `init`.**~~ Decided: `.agents/skills/` (read by
   Copilot, Codex, Cursor, and Gemini CLI), with `--claude` for Claude Code
   ([agent skills](../../setup/agent-skills.md)).
2. **One skill or several.** Should we keep a single `projections` entry point
   that routes to reference files, or split it into separate skills (setup,
   extractor, renderer, comparator) that trigger more accurately at the cost of
   more description tokens per session?
3. **A `projections skills` command.** Do we need a dedicated subcommand, or are
   `init --skill` and `doctor` enough?
4. **Marketplaces at launch.** Should we list a plugin in GitHub's and
   Anthropic's marketplaces on day one, or wait for demand?
5. **Telemetry.** skills.sh ranks packages using the `skills` CLI's install
   telemetry, which we don't control. Is that acceptable as a public signal, or
   should our install docs lead with `gh skill`?
