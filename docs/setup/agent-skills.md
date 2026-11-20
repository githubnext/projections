# Agent skills: where they go

When you run `projections init`, it writes an
[agent skill](https://agentskills.io)—the guide coding agents load whenever a
task involves a projection (you can also print the same guide with
`projections help authoring`). Because different agents look in different
directories for skills, this page explains where `init` places the file, which
agents discover it there, and how to wire up the rest.

## What `init` does

The skill lives at `<skills directory>/projections/SKILL.md` relative to the
repository root. `init` picks the directory in this order:

1. Whatever you pass via `--skills-dir DIR` (relative to the repository root).
2. Whichever directory already contains the skill (checked in order:
   `.agents/skills`, `.github/skills`, then `.claude/skills`), so you never end
   up with a duplicate copy.
3. An existing `.agents/skills`, `.claude/skills`, or `.github/skills`
   directory—picking whichever already holds the most of your repository's own
   skills so it follows your convention, and breaking ties in favor of the
   directory the most agents read (in that same order). When multiple
   directories exist, `init` prints which one it chose and why.
4. `.agents/skills` as the fallback.

After writing the file, `init` prints where it went and which agents will pick
it up:

```text
Agent skill:
  .agents/skills/projections/SKILL.md (created)
    read by GitHub Copilot, OpenAI Codex, Cursor and Gemini CLI
  Claude Code reads only .claude/skills: projections init --claude links the skill there
  Agents load it to build projections. --skills-dir DIR writes it elsewhere; --no-skill doesn't write it
```

If you want to scaffold a projection without writing, updating, or moving the
skill, run `projections init <id> --no-skill`. Agents can still follow the guide
printed by `projections help authoring`.

Every run of `init` refreshes the skill to match your installed CLI version,
recording that version in front matter under `metadata.projections-version`.
`projections doctor` warns if the file drifts from your CLI version. If you've
customized the skill and want to keep your changes, delete that version line and
`init` will leave the file untouched. `init` never modifies other skills, and if
you move the skill with `--skills-dir`, it cleans up any copy it previously
wrote in the other two standard directories so agents reading both won't see
duplicates.

### Claude Code

Because Claude Code only reads `.claude/skills`, run `projections init --claude`
to expose the skill there. Depending on your OS and flags, it creates either:

- a relative symlink from `.claude/skills/projections` to
  `../../.agents/skills/projections`, which Claude Code follows; or
- a copy on Windows, where creating symlinks requires Developer Mode or
  administrator privileges. You can also pass `--claude copy` on any platform—a
  good idea if teammates check out the repository on Windows, since Git's
  `core.symlinks` defaults to off there and turns a committed symlink into a
  plain text file no agent can read. Pass `--claude link` to explicitly request
  a symlink.

Subsequent runs of `init` (with or without `--claude`) keep a copy in sync and
verify an existing link. If the skill already lives in `.claude/skills`, or if
`.claude/skills` itself is a symlink to your skills directory, `--claude` is a
no-op.

Note that GitHub Copilot and Cursor also read `.claude/skills`. Copilot
deduplicates by skill name, whereas Cursor's documentation doesn't specify how
it handles two skills with the same name, so Cursor may list `projections`
twice.

### Other agents

- If you only use **Cursor or Gemini CLI**, you can pass
  `--skills-dir .cursor/skills` or `--skills-dir .gemini/skills`, though both
  already read the default `.agents/skills`.
- If your agent reads from a different folder, pass that path to `--skills-dir`.
  `init` will let you know when no agent it recognizes reads that location.
- If your agent doesn't support skills at all, ask it to run
  `projections help authoring`, or connect it to `projections mcp`.

## Which agents read which directories

The table below reflects each vendor's documentation as of November 2026. Every
listed agent also reads personal skills from your home directory, which `init`
never touches.

<!-- prettier-ignore -->
| Directory | GitHub Copilot | Claude Code | OpenAI Codex | Cursor | Gemini CLI |
|---|---|---|---|---|---|
| `.agents/skills` | yes | no | yes | yes | yes |
| `.claude/skills` | yes | yes | no | yes | no |
| `.github/skills` | yes | no | no | no | no |
| Its own | `.github/skills` | `.claude/skills` | `.agents/skills` | `.cursor/skills` | `.gemini/skills` |
| Symlinked skill folders | not documented; works (tested) | yes | yes | not documented | not documented |
| Parent directories | `.github/skills` only (CLI) | up to the repository root | up to the repository root | not documented | no |

- **GitHub Copilot** (CLI, cloud agent, code review, the app, VS Code, Visual
  Studio, and JetBrains IDEs) reads `.github/skills`, `.claude/skills`, and
  `.agents/skills`
  ([agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)).
  When two skills share a name, the CLI prefers `.github`, then `.agents`, then
  `.claude`, and it also walks parent directories for `.github/skills` in
  monorepos
  ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#skill-locations)).
  VS Code lists `.github/skills` for its Copilot harness plus `.claude/skills`
  and `.agents/skills` for local sessions
  ([VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills#skill-locations)),
  and only reads a parent repository when
  `chat.useCustomizationsInParentRepositories` is enabled
  ([monorepos](https://code.visualstudio.com/docs/agent-customization/overview#use-customizations-in-a-monorepo)).
  Symlinks aren't documented, though Copilot CLI 1.0.106 loads symlinked skill
  folders in `.claude/skills` and `.github/skills`.
- **Claude Code** reads only `.claude/skills`, checking the starting directory
  and every parent up to the repository or worktree root, plus any nested
  `.claude/skills` once Claude touches files underneath them. A skill folder
  "can be a symlink to a directory elsewhere on disk" and is loaded once even if
  multiple entries point to it
  ([skills](https://code.claude.com/docs/en/skills#choose-where-skills-load),
  [monorepos](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)).
- **OpenAI Codex** reads `.agents/skills` from the starting directory up to the
  repository root and "supports symlinked skill folders and follows the symlink
  target" ([skills](https://developers.openai.com/codex/skills)).
- **Cursor** reads `.agents/skills` and `.cursor/skills`, plus `.claude/skills`
  and `.codex/skills` for compatibility, but not `.github/skills`. Nested
  `.agents/skills` or `.cursor/skills` directories anywhere in the repo apply to
  their subtree ([skills](https://cursor.com/docs/skills#skill-directories)).
  Symlink behavior isn't documented.
- **Gemini CLI** reads `.gemini/skills` and its alias `.agents/skills` (which
  takes precedence when both define the same skill; see
  [skills](https://geminicli.com/docs/cli/skills/#discovery-tiers)). It looks
  only in the workspace directory and only after the folder is trusted
  ([source](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillManager.ts)).
  Symlinks aren't documented, though `/skills link` can link skills from a local
  directory.

In short, `.agents/skills` reaches every agent listed here except Claude Code,
`.claude/skills` reaches Claude Code, Copilot, and Cursor, and `.github/skills`
reaches only Copilot. Because Gemini CLI and Copilot's `.agents/skills` loader
don't walk parent directories, `init` always writes at the repository root.

## Skills for working on Projections itself

Contributor skills for working on this repository live in
[`.agents/skills/`](../../.agents/skills/). They set `metadata.internal: "true"`
so `npx skills add githubnext/projections` won't offer them to end users
([skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md#optional-fields)),
while `gh skill` skips hidden directories automatically. If you contribute with
Claude Code, symlink the ones you want into `.claude/skills` in your clone.
