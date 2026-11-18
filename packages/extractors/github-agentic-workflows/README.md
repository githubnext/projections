---
description: GitHub Agentic Workflows' triggers, scope, outputs, budgets and lock state (architecture/v0)
---

# GitHub Agentic Workflows — `architecture/v0`

`github-agentic-workflows` reads the agentic workflows a repository declares
with [GitHub Agentic Workflows](https://github.com/github/gh-aw) (gh-aw):
markdown files under `.github/workflows` whose YAML front matter configures an
AI agent, compiled by `gh aw compile` into a committed `.lock.yml`. Each
workflow is one `workflow` entity holding what a reviewer asks of it: what
starts it, the engine and model, what its agent can reach (tools, GitHub
toolsets and repositories, bash commands, MCP servers, network allowlist,
permissions), what it may write (safe outputs and their limits), the secrets it
references, what it loads (imports and skills), its budgets (timeout, turns, AI
credits) and whether its lock file is current. It writes the
[agentic workflow model](../../../docs/models/agentic-workflow-model.md)
(`agentic-workflows/v0`).

```json
{
  "id": "agentic-workflows",
  "extractor": "github-agentic-workflows",
  "inputs": {
    "groups": "prefix",
    "classes": {"guardrail": ["skills/check-*", ".github/workflows/shared/check-*.md"]}
  }
}
```

The markdown is the workflow, so reading it runs nothing and needs no trust
(`access: files`, `determinism: pure`): the same files always give the same
extraction, whatever order they are listed in.

## What it reads

- **Workflows**: every `.md` the `paths` globs select (default
  `.github/workflows/*.md`, gh-aw's own non-recursive discovery), minus
  `exclude` and `README.md`. A file whose front matter has no `on` is a shared
  component (or a `redirect:` stub) and isn't a workflow of its own.
- **Front matter**, read as gh-aw v1.3.0 reads it: `on` (triggers, and the
  activation settings gh-aw adds under it: roles, bots, reactions, skip
  conditions, manual approval), `engine` and `model`, `tools` (with
  `tools.github`'s toolsets, `allowed-repos`, `min-integrity`, `lockdown` and
  `read-only`, and `bash`'s commands), `mcp-servers`, `network`, `permissions`,
  `safe-outputs` (each handler's `max`, `target`, `target-repo`,
  `allowed-repos`, `allowed`, `workflows`, `draft` and `staged`), `skills`,
  `imports`, `timeout-minutes`, `max-turns`, `max-tool-calls`, `max-ai-credits`,
  `max-daily-ai-credits`, custom `jobs` and steps, `concurrency` and `strict`.
  Secrets are the `${{ secrets.NAME }}` references in any front matter value.
- **Imports**, transitively, resolved as gh-aw resolves them (relative to the
  importing file, the workflow's directory or the repository's `.github`). Their
  `tools`, `mcp-servers`, `network.allowed` and `safe-outputs` are merged into
  the workflow's, as gh-aw merges them, and every merged item records the import
  it came from (`data.sources`), so a widened allowlist that arrives through a
  shared file is visible. Imports from other repositories are listed but not
  read.
- **Lock files**: the first lines of each `<name>.lock.yml` (below).

`groups` makes units of workflows that work together: `"prefix"` groups a
workflow with the workflows named after it and a dash (`docs-bot` with
`docs-bot-links` and `docs-bot-examples`), and an object of group name to globs
groups by path or name. Each group is a `group` entity that `contains` its
workflows. `classes` names imports and skills by glob, such as `guardrail` for
`skills/check-*`; each import and skill lists its classes, and the
[`agentic-workflows` comparator file](../../comparators/agentic-workflows/README.md)
warns when a classified one is removed. A workflow whose `dispatch-workflow` or
`call-workflow` safe output names another workflow `dispatches` it.

## gh-aw's changing front matter

gh-aw reached general availability recently and its front matter schema has been
changing. The extractor is built to keep working across that churn rather than
fail on it, and to say so:

- **A pinned schema.** [`vendor/gh-aw/fields.json`](vendor/gh-aw/fields.json) is
  the fields gh-aw's published front matter schema
  (`pkg/parser/schemas/main_workflow_schema.json`) declares at each object the
  extractor reads, at the release
  [`vendor/gh-aw/vendor.json`](vendor/gh-aw/vendor.json) records (v1.3.0,
  `789cc9c2`), with each safe output's default `max` as the schema documents it,
  so a handler that sets none compares with one that does. Every extraction
  records the release in `metadata.ghAw`.
- **Unknown fields are facts, not failures.** A field the pinned schema doesn't
  declare (a newer gh-aw's, or a typo gh-aw would reject), in the workflow or in
  any file it imports, is listed in the workflow's `data.unrecognized` with a
  finding that names the file. Its value is kept in `data.unrecognizedValues`,
  so changing it marks the workflow modified. As gh-aw does, custom agent files
  (`.github/agents/*.md`) aren't checked, and a connector's safe outputs
  (`jira-add-comment`) are known.
- **Renames are normalized.** Fields gh-aw renamed, which its `gh aw fix`
  codemods migrate (`timeout_minutes`, `on.command`, top-level `roles`,
  `engine.max-turns`, `tools.github.repos`, `safe-outputs.missing-tool`, …), are
  read under their current names and listed in `data.deprecated` with the
  codemod (and the import that uses one). So migrating a workflow with
  `gh aw fix` changes nothing but the deprecation findings.
- **Drift is a notice.** A lock file compiled by a gh-aw newer than the pinned
  release gets a `newer-compiler` finding: fields that release added may show as
  unrecognized until the pin moves.

To move to a new gh-aw release:

1. Change `release` and `commit` in [`scripts/schema.mjs`](scripts/schema.mjs)
   and run `node scripts/schema.mjs` (or `--source <gh-aw checkout>` at that
   tag); `--check` compares the committed table with the release's.
2. Review gh-aw's new codemods (`pkg/cli/codemod_*.go`) and add the field
   renames to `RENAMES` in [`src/fields.rs`](src/fields.rs).
3. If gh-aw changed how it hashes sources (`pkg/parser/frontmatter_hash.go`),
   update [`src/hash.rs`](src/hash.rs), then run the corpus test below against
   that release's checkout.
4. Build gh-aw at the tag and regenerate the fixtures:
   `go build -ldflags "-X main.version=<tag> -X main.isRelease=true" -o /tmp/gh-aw ./cmd/gh-aw`
   in a gh-aw checkout, then `node scripts/fixtures.mjs --gh-aw /tmp/gh-aw`, and
   update the goldens
   (`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-github-agentic-workflows`).

## Lock files

gh-aw writes the hashes of the source it compiled into the first line of each
lock file (`# gh-aw-metadata: {"frontmatter_hash": …, "body_hash": …}`) and
checks them when the workflow runs. The extractor recomputes both from the
revision exactly as gh-aw v1.3.0 does ([`src/hash.rs`](src/hash.rs) follows
`pkg/parser/frontmatter_hash.go`): the front matter text, its imports' front
matter and the template expressions the body and its imports use, then the body
and its imports' bodies. `data.lock.status` is:

- `current`: the lock was compiled from this source;
- `stale`: the front matter or what it imports changed since, so the compiled
  workflow isn't what the source says (or the prompt changed and the workflow
  sets `on.stale-check: full`); gh-aw fails such a run;
- `missing`: there is no lock file;
- `unverified`: the lock records no hash, or gh-aw couldn't hash the source
  either (an import outside `.github`), with the `reason`.

A prompt-only change leaves the lock current (gh-aw reads the prompt when the
workflow runs) and sets `data.lock.body: changed`. `data.lock.compiler` is the
gh-aw release that compiled it, when the lock says.

The check is verified against gh-aw itself: every one of the 368 workflows gh-aw
v1.3.0 compiled in its own repository reads as current, including those with
imports, `inlined-imports` and runtime imports, as do agentics' locks compiled
by v0.88.3 and v0.93.3. [`tests/corpus.rs`](tests/corpus.rs) repeats that
against any checkout:

```sh
git clone --depth 1 --branch v1.3.0 https://github.com/github/gh-aw /tmp/gh-aw
GH_AW_CHECKOUT=/tmp/gh-aw cargo test -p projections-extractor-github-agentic-workflows --test corpus -- --ignored --nocapture
```

## Fixtures

[`tests/fixtures`](tests/fixtures/README.md): real workflows from gh-aw and
githubnext/agentics at pinned commits (`public`), and two synthetic pull
requests compiled by gh-aw v1.3.0: `repo-ask` widens a public workflow's network
and outputs, and `docs-bot` widens a group of documentation workflows'
repositories, toolsets, bash, network and budgets, removes a guardrail skill and
leaves one lock stale. `scripts/fixtures.mjs` regenerates them.

## What fails

Nothing a workflow declares fails the extraction: a workflow whose front matter
isn't valid YAML is listed with an `invalid` finding, and one gh-aw would reject
is read as far as it goes. The extraction fails only on invalid inputs (a
`groups` or `classes` that isn't the documented shape, an invalid glob).
