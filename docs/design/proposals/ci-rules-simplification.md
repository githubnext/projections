# Proposal: simpler CI rules

Status: **accepted with changes; being implemented.** The first step is #159.
This note measures how far the rules in `.github/ci-rules.json` can be
simplified, and what each simplification costs, so a person reading the rules
can tell what runs for a change. It was revised after two reviews; the changes
are at the end.

## The problem

The rules decide what CI runs for a pull request
([what CI runs](../../../CONTRIBUTING.md#what-ci-runs)). They are thorough, but
reading them means holding a lot in mind at once:

- **13 forms of `when`.** `always`, `full`, `docsOnly`, `reachesSuite`, `if`,
  `changes`, `tag`, `generator`, `changed`, `reaches` (with an optional `from`),
  `any`, `all` and `not`. There are three ways to say "a file matched" (tags,
  `changes` globs, file rules) and three to say "a package changed" (`changed`,
  `reaches`, `reachesSuite`).
- **File rules with side effects.** Six effects (`full`, `docs`, `checks`,
  `owner`, `readers`, `lockfile`), three flags (`read`, `owned`, `root`), and
  effects that apply whichever rule matched: tags and generators always attach,
  and the crates that read a file count unless the effect is `checks`.
- **Repetition.** `"full"` opens nearly every `any`. The `os-specific` tag, the
  `os-specific` condition and the `rust` condition repeat each other's globs.
- **Savings that are hard to check by eye.** `from` scoping and the harness's
  `narrow` each save jobs in ways a reader can't verify from the file.

In all: 3 tags, 12 groups, 8 conditions, 5 group selector forms and 457 lines.

## The model

The planner evaluates a change in this order:

1. **Classify each file.** Every changed file gets exactly one class, and
   nothing else happens to it:
   1. the first file rule whose paths match it gives the class: `lockfile`,
      `full`, `docs`, `checks` or `code`;
   2. a `docs` file that a crate reads by path, or a generator reads or writes,
      is `checks` instead, since the Linux checks run every crate's tests and
      every generator's check;
   3. a file no rule matches is `code` when a workspace or crate contains it or
      anything (a crate, a renderer's scenarios or a generator) reads it, and
      `full` otherwise.

   A `code` file touches the workspace or crate containing it and those reading
   it by path; with neither, as for `brand/projections-mark.svg` or
   `notices/notices.json` (unowned, but a generator's input or output), it
   touches nothing and only the Linux checks run. A `lockfile` is `code` for the
   workspaces and crates whose resolved dependencies changed, and `full` when
   the root's own tooling changed or there's no earlier version to compare.

2. **Full runs.** A push to `main`, the nightly run, a manual run, the `ci:full`
   label or any `full` file runs every job, matrix entry and suite, whatever its
   `when` says.
3. **Touched and reached units.** The touched units are those the `code` files
   touch. The reached units are the touched ones and everything depending on a
   unit that contains or builds in a changed file: _reaches = built ∪ tested ∪
   dependants(built)_. A crate whose tests alone read a file is touched, so its
   own suites run, but nothing is reached through it.
4. **Evaluate `when`.** Path predicates (`changes`) and package predicates
   (`touches`, `reaches`) are evaluated independently. `changes` looks at paths
   whatever their class: `action.yml` is `code` and also selects the jobs whose
   `changes` name it; `Cargo.lock` is a lockfile and also a Rust change.
5. **Expand suites and matrices.** Each browser suite runs when the change
   reaches it or a workspace its `test:browser` script builds, or its own `when`
   holds. Sharded suites get their own jobs and the rest share `browser (rest)`;
   the harness is narrowed when only some renderers changed; `public-product`
   becomes its matrix.

## How this was measured

The implementation (#159) was replayed against the planner on `main` at
execution level: every check with its suites, Playwright project, shard and
`--grep-invert`, including which suites `browser (rest)` runs. Samples:

- **4,200 synthetic change sets:** every tracked file alone, and 400 random
  pairs. Every file is weighted equally, so this shows _which kinds of file_
  change plan, not how often.
- **The 40 merged pull requests #84 to #141,** lockfiles compared at their merge
  commits. 16 ran everything; 24 followed their change ("selective").

**Prices** are runner-minutes: the median of the last 8 full runs on `main`, and
pull request runs for narrowed harness jobs and `docs`. `mutants-diff` is 6
runners of 2.1 minutes. `browser (rest)` is 12.4 minutes of setup and build plus
each suite it runs: the VS Code UI 8.2, the CLI 3.2, the Engine's Wasm build
0.7, the minimal example 0.25 and the comparator runtime under 0.1. So a change
to which suites `rest` runs is priced, not hidden in an unchanged check.

Today the 40 pull requests ran **1,023 runners for 18,884 runner-minutes**,
2,699 of them on macOS; the selective 24 ran 383 runners, 8,180 minutes.

**Wall time.** Observed, single-attempt successful runs of these pull requests
took 41 to 58 minutes (median 51) when code changed, and about a minute for
documentation alone; reruns took up to 221. In the model the critical path of
every non-documentation run is `public-product (ubuntu-latest)`, about 37
minutes, in every variant here, so none of them moves wall time beyond that
noise. What they cost is runner-minutes.

## The simplifications, one at a time

| Step                                                         | 40 PRs: runners | Runner-minutes (selective PRs) | PRs whose plan changes                | Synthetic sets that change |
| ------------------------------------------------------------ | --------------- | ------------------------------ | ------------------------------------- | -------------------------- |
| Today                                                        | 1,023           | 18,884 (8,180)                 |                                       |                            |
| 1. A full run runs every job                                 | +16             | +10 (0)                        | the 16 full runs                      | 275                        |
| 2. No tags, no `generator`                                   | 0               | 0                              | none                                  | 0                          |
| 3. `touches` and `reaches`, test readers counted             | 0               | 0                              | none                                  | 5                          |
| 4. One class per file, read docs derived                     | 0               | 0                              | none                                  | 0                          |
| 5. No `from`                                                 | +2              | +26 (+0.3%)                    | #127, #128; #92 `rest`                | 1,158                      |
| **Adopted (#159): 1 to 5, `narrow` and `facts` kept**        | **+18**         | **+35, +0.2% (+26, +0.3%)**    | 19: the 16 full runs, #92, #127, #128 | 1,438                      |
| Not adopted, from the adopted: no `narrow`                   | +18             | +396 (+4.8%)                   | #127, #128                            | 465                        |
| Not adopted, from the adopted: one verb (`reaches` for Rust) | +26             | +799 (+9.7%)                   | 10                                    | 1,368–1,475                |

### 1. A full run runs every job

Instead of `"full"` in nearly every condition, a full run runs every job, and
`when` describes only pull requests that follow their change. `actions-lock`,
which runs only in full runs, says `"when": "never"`. Cost: the `docs` job also
runs in full runs, 0.6 minutes each. **Adopted.**

### 2. No tags, no `generator` predicate

A tag is a set of globs any file can carry, whichever file rule matched it; a
condition with `changes` says the same thing where it's used. The one
`generator` use, `release-workflow`, was redundant: its output is under
`.github/workflows/` (a full run), and its inputs are the globs `release-config`
names. Generators stay in the graph, where they make a file read (step 4). No
cost. **Adopted.**

### 3. Two package verbs

- `touches: group`: a member contains, builds in or reads a changed file, tests
  included. This was `changed`.
- `reaches: group`: a member is touched, or depends on a unit that contains or
  builds in a changed file.

A suite runs when the change reaches it, so `reachesSuite` is implied. The only
difference from today: `reaches` now includes crates whose tests alone read a
file, so when the CLI's test fixtures (`examples/comparators/priority-order/**`)
change, the CLI's browser suites run too (5 synthetic sets, no pull request).

**One verb, not adopted.** With `reaches` alone, a change to a renderer, the kit
or the host is a Rust change, because the CLI (a crate) embeds them all, and the
Windows Rust, Node and integration jobs run for it: 10 of the 24 selective pull
requests (#95, #99, #104, #107, #126, #127, #128, #136, #139, #140), +799
runner-minutes, +9.7% for selective pull requests. Using `reaches` for
`platform` alone costs +461; for Verus, nothing.

### 4. One class per file

Each file gets one class, as in [the model](#the-model). The first version of
this note replaced the derived "read documentation is checks" rule with an
explicit list of 11 globs. Both reviews found that list misses documentation
that doesn't exist yet: a new `packages/extractors/<x>/NOTES.md`, which the
CLI's tests read by directory, would have been documentation, skipping the CLI's
tests. The rule stays derived: the graph already knows what reads what, and a
table case checks newly added paths.

`lockfile` loses its `root` option: when the root's own tooling changes,
everything runs, as it does today. `LICENSE` keeps today's behaviour: it isn't
documentation by path, and the CLI embeds it, so it's the CLI's change. (Calling
it read documentation would drop all three Windows jobs, `package`, both
Inspector shards and `browser (rest)`: about 163 runner-minutes, for the one
file the CLI ships as its license.)

No cost: no file changes class.

### 5. `from`, `narrow`, `facts` and `all`

- **`from`: dropped.** It let `package` and the minimal example ignore changes
  that reach the CLI only through an extractor or one renderer. Without it,
  `package` (12.7 minutes) runs for those too, #127 and #128 over the 40, and
  the minimal example runs in `browser (rest)` for extractor changes (+0.25
  minutes, 776 synthetic sets). It removes three groups (`extractors`,
  `not-extractors`, `cli-served`) whose only use was `from`.
- **`narrow`: kept.** The first version of this note dropped it as the hardest
  rule to trust. But it's what makes the most common small change cheap: a
  change to one renderer (#127, #128) runs 16 runners for 310 runner-minutes
  with it, and 25 for 508 without (+64%, +71% against today), with macOS going
  from 18.6 to 54.2 minutes (+191%). Over the selective pull requests, dropping
  it costs 4.8%. Instead of dropping it, make it visible: the explanation prints
  the `--grep-invert` and the renderers left out, and the miss detector (step 6)
  watches what it skips.
- **`facts`: kept.** `{"facts": "coverage"}` and
  `{"changes": {"facts": "mutants"}}` read `test:rust:coverage`'s `-p` arguments
  and `.cargo/mutants.toml`'s globs, including `exclude_globs`. Literal paths
  with drift tests would say the same thing in two places.
- **`all`: dropped.** Nothing used it.

### 6. Confidence tooling

- **`tools ci explain [files] [--base REF]`.** Every check, run or skipped, from
  the same execution plan CI uses: each file's class and the rule that gave it,
  each reached unit's witness (the dependency that reached it), and for each job
  the conditions that held or, when it's skipped, the ones that didn't. The run
  summary prints the same.
- **A generated "what runs for what" table** in CONTRIBUTING.md, from
  `ci-plan.cases.json`, registered as a generator so `docs:check` keeps it
  current.
- **The plan as an artifact.** The `changes` job uploads its plan, so anyone
  (and the miss detector) can see what a run decided and why.
- **`tools ci replay`.** A local command that replays the last merged pull
  requests (and every tracked file) against the rules on `main` and the working
  tree, at execution level and priced, as this note does. Run it before changing
  the rules; it isn't a CI step.
- **A miss detector, report-only.** When a job fails on `main` that the merged
  pull request's plan skipped, and the same job passed on the parent commit's
  run, the run's summary reports a likely miss: the job, the pull request and
  the plan's reasons. No issues are filed and nothing is re-run; once it has a
  record, it can do more.

## Summary

| Concept          | Today                            | Adopted                                                                               |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| Forms of `when`  | 13, plus `from`                  | 9: `always`, `never`, `docsOnly`, `if`, `changes`, `touches`, `reaches`, `any`, `not` |
| File rules       | 6 effects, 3 flags, side effects | one class per file: 5 classes, one derived rule, then the graph                       |
| Tags             | 3                                | none                                                                                  |
| Groups           | 12, 5 selector forms             | 9, 4 selector forms (glob, `@group`, `kind`, `facts`)                                 |
| Conditions       | 8                                | 3 (`rust`, `os-specific`, `platform`)                                                 |
| Browser suites   | a default `when`, `narrow`       | implied reach, an optional `when`, `narrow`                                           |
| Rules file       | 457 lines                        | 300 lines                                                                             |
| Cost over 40 PRs |                                  | +18 runners, +35 runner-minutes (+0.2%; selective +0.3%), no wall time                |

## Implementation

1. #159: the rules restated (steps 1 to 5), with the replay showing that plans
   match today's except where this note says, and the execution plan.
2. `tools ci explain`, the generated table and the plan artifact.
3. `tools ci replay`.
4. The miss detector, report-only.

## What the reviews changed

Two reviews of the first version agreed to adopt it with changes:

1. The derived "read documentation is checks" rule stays (step 4), instead of an
   explicit list that misses new files.
2. The `facts` selectors stay; the unused `all` goes (step 5).
3. Plans are compared at execution level, and `browser (rest)` is priced by the
   suites it runs. The first version compared job names, which missed 776
   synthetic sets where `rest` ran a different set of suites.
4. The evaluation order is stated ([the model](#the-model)), including that
   `changes` is independent of a file's class, what `reaches` counts, and that
   unowned generator files are `code`, not `full`.
5. Figures: `mutants-diff` counts as its 6 runners; selective pull requests are
   reported alongside the total; `LICENSE` keeps its behaviour; wall time is the
   observed range. `narrow` is kept, given what it saves on renderer changes.
6. Tooling: `explain` takes `--base` and names witnesses, replay is a local
   command, and the miss detector only reports.

## Appendix: one verb, where it differs

With one package verb, these conditions and jobs would become:

```json
{
  "rust": {"when": {"any": [{"changes": ["**/*.rs", "**/Cargo.toml", "**/Cargo.lock", "rust-toolchain.toml"]}, {"reaches": "crates"}]}},
  "platform": {"when": {"any": [{"if": "rust"}, {"changes": ["action.yml"]}, {"reaches": "not-browser-only"}]}},
  "verus": {"when": {"reaches": "engine"}}
}
```
