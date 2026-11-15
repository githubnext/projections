Scaffolds a projection, or adds parts to an existing one, and writes or updates
the skill a coding agent follows to build it. Projection files are never
overwritten.

```text
A projection has three parts, each optional to customize:
  extractor   turns a revision into entities and relationships. Default: a starter program in the
              repository's toolchain (Node for package.json; Python for pyproject.toml, requirements.txt,
              setup.py or Pipfile; Go for go.mod), or --language. --extractor uses a built-in one and
              --command an existing program.
  renderer    presents an extraction or comparison. Default: the built-in graph renderer. --renderer NAME
              picks another built-in; --renderer custom scaffolds a TypeScript, Vite and React package using
              the renderer SDK and kit (npm install && npm run dev in it).
  comparator  matches, explains and orders a comparison's changes. Rarely needed; the default one is used
              unless --comparator custom scaffolds a starter comparator file (YAML and CEL, run
              sandboxed) and the tests beside it, which projections check runs.
```

```text
Files, for ID service-map:
  .github/projections/service-map.json             the definition
  .github/projections/service-map/extract.mjs      starter extractor (.py, .go)
  .github/projections/service-map/renderer/        custom renderer package (with --renderer custom)
  .github/projections/service-map/service-map.comparator.yaml       starter comparator (with --comparator custom)
  .github/projections/service-map/service-map.comparator.test.yaml  its tests (with --comparator custom)
  .agents/skills/projections/SKILL.md              the agent skill
```

The skill goes in .agents/skills, which GitHub Copilot, OpenAI Codex, Cursor and
Gemini CLI read, unless the repository already has the skill elsewhere or has
only .claude/skills (Claude Code, GitHub Copilot, Cursor) or .github/skills
(GitHub Copilot); --skills-dir chooses. Claude Code reads only .claude/skills:
--claude links the skill there (a relative symlink; a copy on Windows, or with
--claude copy). Every run updates the skill, and a copy for Claude Code, to this
CLI's version, unless its front matter has no metadata.projections-version (so
remove that line to keep your edits); other skills are never touched.

Run again with --renderer custom, --comparator custom or an extractor option to
add that part to an existing projection; only those fields of its definition
change. Without ID, writes only the skill.
