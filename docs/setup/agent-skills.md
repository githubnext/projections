# Agent skills: where they go

`projections init` writes an [agent skill](https://agentskills.io), the guide a
coding agent loads whenever a task involves a projection
(`projections help authoring` prints the same guide). Each agent reads skills
from its own directories, so this page says where `init` puts the skill, which
agents find it there, and how to reach the others.

## What `init` does

The skill is `<skills directory>/projections/SKILL.md`, at the repository root.
`init` chooses the skills directory in this order:

1. `--skills-dir DIR`, relative to the repository root.
2. The directory that already holds the skill (`.agents/skills`,
   `.github/skills`, then `.claude/skills`), so a second copy never appears
   beside it.
3. An existing `.agents/skills`, `.claude/skills` or `.github/skills`: the one
   holding the most of the repository's own skills, so the skill follows the
   repository's convention, and of those that tie, the one the most agents read
   (in that order). When several exist, `init` says which it chose and why.
4. Otherwise `.agents/skills`.

It prints where the skill is and which agents read it there:

```text
Agent skill:
  .agents/skills/projections/SKILL.md (created)
    read by GitHub Copilot, OpenAI Codex, Cursor and Gemini CLI
  Claude Code reads only .claude/skills: projections init --claude links the skill there
  Agents load it to build projections. --skills-dir DIR writes it elsewhere; --no-skill doesn't write it
```

`projections init <id> --no-skill` scaffolds the projection without writing,
updating or moving the skill; agents then follow the guide
`projections help authoring` prints.

Every run updates the skill to the running CLI's version. The skill records that
version in its front matter, as `metadata.projections-version`, and
`projections doctor` warns when it is from another version. To keep your own
edits, delete that line: `init` then leaves the file alone. `init` never touches
other skills. With `--skills-dir`, a copy `init` wrote in another of the three
directories is removed, since agents that read both would see two.

### Claude Code

Claude Code reads only `.claude/skills`. `projections init --claude` adds the
skill there:

- a relative symlink, `.claude/skills/projections` →
  `../../.agents/skills/projections`, which Claude Code follows;
- on Windows, a copy, since symlinks there need Developer Mode or administrator
  rights. `--claude copy` makes a copy anywhere: use it when the repository is
  also checked out on Windows, where Git's `core.symlinks` is off by default and
  turns a committed symlink into a small text file that no agent can read.
  `--claude link` asks for a link.

Later runs of `init`, with or without `--claude`, keep a copy in sync and check
a link. `--claude` does nothing when the skill is already in `.claude/skills`
(or `.claude/skills` is itself a link to the skills directory).

GitHub Copilot and Cursor read `.claude/skills` too. Copilot keeps one skill per
name; Cursor's documentation doesn't say how it treats two skills with the same
name, so it may list `projections` twice.

### Other agents

- **Cursor or Gemini CLI only:** `--skills-dir .cursor/skills` or
  `--skills-dir .gemini/skills`. Both also read `.agents/skills`, the default.
- **An agent that reads skills from another directory:** `--skills-dir` with
  that directory. `init` says when no agent it knows reads it.
- **An agent without skills:** ask it to run `projections help authoring`, or
  connect it to `projections mcp`.

## Which agents read which directories

From each vendor's documentation, checked in November 2026. Every agent below
also reads personal skills from the home directory, which `init` doesn't write.

<!-- prettier-ignore -->
| Directory | GitHub Copilot | Claude Code | OpenAI Codex | Cursor | Gemini CLI |
|---|---|---|---|---|---|
| `.agents/skills` | yes | no | yes | yes | yes |
| `.claude/skills` | yes | yes | no | yes | no |
| `.github/skills` | yes | no | no | no | no |
| Its own | `.github/skills` | `.claude/skills` | `.agents/skills` | `.cursor/skills` | `.gemini/skills` |
| Symlinked skill folders | not documented; works (tested) | yes | yes | not documented | not documented |
| Parent directories | `.github/skills` only (CLI) | up to the repository root | up to the repository root | not documented | no |

- **GitHub Copilot** (the CLI, cloud agent, code review, the app, VS Code,
  Visual Studio and JetBrains IDEs) reads `.github/skills`, `.claude/skills` and
  `.agents/skills`
  ([agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)).
  For two skills with one name, the CLI uses the first of `.github`, `.agents`
  and `.claude`, and it also reads `.github/skills` in parent directories, for
  monorepos
  ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#skill-locations)).
  VS Code's own table names `.github/skills` for its Copilot harness and adds
  `.claude/skills` and `.agents/skills` for local sessions
  ([VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills#skill-locations));
  it reads a parent repository only with
  `chat.useCustomizationsInParentRepositories`
  ([monorepos](https://code.visualstudio.com/docs/agent-customization/overview#use-customizations-in-a-monorepo)).
  Symlinks aren't documented; Copilot CLI 1.0.106 loads a symlinked skill folder
  in `.claude/skills` and `.github/skills`.
- **Claude Code** reads only `.claude/skills`, in the start directory and every
  parent up to the repository (or worktree) root, and `.claude/skills` below it
  once Claude works on files there. A skill folder "can be a symlink to a
  directory elsewhere on disk", loaded once however many entries point at it
  ([skills](https://code.claude.com/docs/en/skills#choose-where-skills-load),
  [monorepos](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)).
- **OpenAI Codex** reads `.agents/skills` in every directory from the start
  directory up to the repository root, and "supports symlinked skill folders and
  follows the symlink target"
  ([skills](https://developers.openai.com/codex/skills)).
- **Cursor** reads `.agents/skills` and `.cursor/skills`, and for compatibility
  `.claude/skills` and `.codex/skills`, but not `.github/skills`; nested
  `.agents/skills` or `.cursor/skills` anywhere in the repository apply to their
  subtree ([skills](https://cursor.com/docs/skills#skill-directories)). Symlinks
  aren't documented.
- **Gemini CLI** reads `.gemini/skills` and its alias `.agents/skills`, which
  wins when both have a skill
  ([skills](https://geminicli.com/docs/cli/skills/#discovery-tiers)), in the
  workspace directory only and once the folder is trusted
  ([source](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillManager.ts)).
  Symlinks aren't documented; `/skills link` links skills from a local
  directory.

So `.agents/skills` reaches every agent here but Claude Code, `.claude/skills`
reaches Claude Code, Copilot and Cursor, and `.github/skills` only Copilot.
Gemini CLI and Copilot's `.agents/skills` don't look in parent directories,
which is why `init` writes at the repository root.

## Skills for working on Projections itself

This repository's own skills, for contributors, are in
[`.agents/skills/`](../../.agents/skills/). They set `metadata.internal: "true"`
so that `npx skills add githubnext/projections` doesn't offer them
([skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md#optional-fields));
`gh skill` skips hidden directories. With Claude Code, link one into
`.claude/skills` in your clone.
