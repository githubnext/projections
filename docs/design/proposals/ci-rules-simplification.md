# Proposal: simpler CI rules

Status: **proposal**. Nothing here is implemented. It measures how far the rules
in `.github/ci-rules.json` can be simplified, and what each simplification
costs, so a person reading the rules can tell what runs for a change.

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
- **Savings that are hard to check by eye.** `from` scoping, the harness's
  `narrow` and the `facts` selectors each save jobs in ways a reader can't
  verify from the file.

In all: 3 tags, 12 groups, 8 conditions, 5 group selector forms and 457 lines.

## How this was measured

A prototype evaluator for the simpler model reuses the merged graph code
(`ci-facts.ts`, `ci-lockfiles.ts`, `ci-browser.ts`); only the rules layer is
new. It was replayed against today's planner on two samples:

- **4,200 synthetic change sets:** every tracked file at `ea96bce` alone, and
  400 random pairs. Every file is weighted equally, so this shows _which kinds
  of file_ change plan, not how often.
- **The last 40 merged pull requests** (#84 to #141), with lockfiles compared at
  their merge commits. 16 of them ran everything; 24 followed their change.

Each job is priced in runner-minutes by the median of the last 8 full runs on
`main`. Narrowed harness jobs and `docs` are priced from pull request runs, and
`mutants-diff` at 6 shards of 2.1 minutes (recent diffs; a large diff takes
about 20 minutes a shard). `browser (rest)` is priced at its full-run time
whatever it contains. Wall time is the longest job.

Today, the 40 pull requests ran **943 jobs, 18,911 runner-minutes**, of which
2,699 were on macOS.

**No simplification here changes any pull request's wall time.** Every
non-documentation pull request waits about 37 minutes for
`public-product (ubuntu-latest)`, longer than any job these rules add or remove.
What they cost is runner-minutes.

## The simplifications, one at a time

Each step is replayed on its own. "V1" restates today's rules in the simpler
shape (steps 1, 2 and 4), and the other steps are measured against it.

| Step                                                        | 40 PRs: jobs | 40 PRs: runner-minutes | PRs whose plan changes                      | Synthetic sets that change |
| ----------------------------------------------------------- | ------------ | ---------------------- | ------------------------------------------- | -------------------------- |
| Today                                                       | 943          | 18,911                 |                                             |                            |
| V1: global full, no tags or `generator`, one class per file | +16          | +10                    | the 16 full runs (the `docs` job also runs) | 278                        |
| From V1: `reaches` instead of `changed` for `rust`          | +28          | +824                   | 10                                          | 1,627                      |
| From V1: `reaches` instead of `changed` for `platform`      | +16          | +461                   | 8                                           | 1,573                      |
| From V1: `reaches` instead of `changed` for `verus`         | 0            | 0                      | none                                        | 0                          |
| From V1: no `from`                                          | +2           | +25                    | #127, #128 (`package`)                      | 386                        |
| From V1: no harness `narrow`                                | +18          | +396                   | #127, #128 (whole harness)                  | 467                        |
| **The full proposal** (all of the above, one package verb)  | **+62**      | **+1,230 (+6.5%)**     | 26: the 16 full runs and 10 others          | 1,816                      |
| **Recommended** (all but the one package verb; see below)   | **+36**      | **+432 (+2.3%)**       | 18: the 16 full runs and #127, #128         | 752                        |

### 1. A full run runs every job

Today `"full"` is a leaf in nearly every condition. Instead: a full run (a push
to `main`, the nightly run, a manual run, `ci:full`, or a file whose class is
`full`) runs every job, and `when` describes only pull requests that follow
their change. `actions-lock`, which runs only in full runs, says
`"when": "never"`.

Cost: the `docs` job also runs in full runs, 0.6 minutes each. An exception for
it would cost more to read than it saves. **Recommended.**

### 2. No tags, no `generator` predicate

A tag is a set of globs any file can carry, whichever file rule matched it; a
condition with `changes` says the same thing in the place it's used. The one
`generator` use, `release-workflow`, is redundant: its output is under
`.github/workflows/` (a full run), and its inputs are the globs `release-config`
already names. Generators stay in the graph, where they decide which
documentation is read (step 4).

Cost: none. Every plan is the same. **Recommended.**

### 3. One package verb

The proposal: `reaches: group` only, dropping `changed` and `from`, with
`reachesSuite` implied for browser suites.

`reachesSuite` implied: no cost, recommended. Each suite runs when the change
reaches it or a workspace its `test:browser` script builds, and `when` adds to
that.

`reaches` instead of `changed`: **not recommended.** `reaches` follows
dependants, and nearly every workspace has a dependant that is a crate or isn't
browser-only, usually the CLI, which embeds the Inspector and through it every
renderer. With `reaches crates`, a change to a renderer, the kit or the host is
a Rust change, so the Windows Rust, Node and integration jobs and `package` run
for it. That's 10 of the 24 pull requests that followed their change: #95, #99,
#104, #107, #126, #127, #128, #136, #139 and #140. Most pay about 90
runner-minutes (#104 and #139, `windows` alone, about 34), 824 in all, for
suites the change doesn't touch.

Instead, keep two verbs and say plainly what each means:

- `touches: group`: a member contains, builds in or reads a changed file;
- `reaches: group`: a member is touched, or depends on a workspace or crate that
  contains or builds in a changed file.

Both count crates that only read a file in their tests (the Engine's tests read
`packages/schemas/fixtures/conformance.json`), which today only `changed` does.
That costs nothing measurable: 4 synthetic sets run the Inspector suite when the
CLI's test fixtures change.

Dropping `from`: **recommended.** `from` let `package` and the minimal example
ignore changes that reach the CLI only through an extractor or one renderer.
Without it, `package` (12.7 minutes) runs for those too. Over the 40 pull
requests that's #127 and #128, 25 runner-minutes, and it removes three groups
(`extractors`, `not-extractors`, `cli-served`) whose only purpose was `from`.

### 4. One class per file

Each file gets exactly one class, and nothing else happens to it:

1. **Path rules, first match:** `lockfile`, `full`, `checks` (the Linux checks
   alone) or `docs`.
2. **Otherwise, from the graph:** `code`, a change to the workspace or crate
   containing it and to the crates that read it by path, if there is one, and
   `full` if nothing contains or reads it.

The one thing a path can't say is _which documentation is read_: help text the
CLI embeds, agent prompts, generated reference and built-in pages, the files the
CLI's tests read. Today a `read` flag derives it. In this model it's a list of
11 globs in a `checks` rule, which covers all 159 such files today and no
others. A test keeps it exact: it fails, naming the file, when a crate or
generator reads a documentation file the list misses. That's more to read than a
flag, but it's what actually happens, in one place.

`lockfile` loses its `root` option: when the root package's own tooling changed,
everything runs, as it does today.

Cost: one file changes plan. `LICENSE`, which the CLI embeds, becomes `checks`
instead of a CLI change, so the Inspector suite and `browser (rest)` no longer
run for it. **Recommended.**

### 5. `from`, `narrow` and `facts`

- `from`: drop it (step 3).
- `narrow`: **drop it.** It's the only rule that runs part of a suite: for a
  change to some renderers alone, the harness leaves the others' tests out with
  a `--grep-invert` built from test titles. It's also the hardest to trust,
  since it depends on how tests are named. Dropping it costs #127 and #128 about
  200 runner-minutes each (14 harness jobs instead of 5, 2 of them on macOS: 71
  more macOS minutes), and no wall time. It removes the `harness-renderers`
  group, the `facts: harnessRenderers` selector, the `grep-invert` input of the
  browser action and `rendererGrep`.
- `facts`: replace `{"facts": "coverage"}` and
  `{"changes": {"facts": "mutants"}}` with the literal paths, each with a test
  that it matches its source (`test:rust:coverage`'s `-p` arguments,
  `.cargo/mutants.toml`'s `examine_globs`). The reader sees the paths; the test
  keeps them honest. Cost: a change to `wasm.rs` alone, which `mutants.toml`
  excludes, runs a `mutants-diff` that finds nothing (2 synthetic sets).

### 6. Confidence tooling

The proposal's three tools, refined, and a fourth:

- **`tools ci explain <files>`.** Every job, run or skipped, each file's class
  and the rule that gave it, and for each job the conditions that held or, when
  it's skipped, the ones that didn't. The run summary prints the same.
- **A generated "what runs for what" table** in CONTRIBUTING.md, from
  `ci-plan.cases.json`, registered as a generator so `docs:check` keeps it
  current.
- **A rules-change replay.** When a pull request changes the rules file, its
  summary lists how the plans of the last 40 merged pull requests change, in
  jobs and runner-minutes, as this note does. A rule's effect is then visible
  before it lands, which reading a predicate can't give.
- **A miss detector.** The `changes` job uploads its plan as an artifact. When a
  job fails on `main` and the merged pull request's plan skipped it, re-run it
  once to rule out a flaky test. If it fails again, open an issue labelled
  `ci-miss` naming the job, the pull request and the plan's reasons. Today a
  miss shows up only as a red `main`, and nobody connects it to the rules.

## Summary

| Concept          | Today                            | Recommended                                                                        |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Forms of `when`  | 13, plus `from`                  | 9: `docsOnly`, `never`, `if`, `changes`, `touches`, `reaches`, `any`, `all`, `not` |
| File rules       | 6 effects, 3 flags, side effects | 4 classes by path, then `code` or `full` from the graph                            |
| Tags             | 3                                | none                                                                               |
| Groups           | 12, 5 selector forms             | 8, 3 selector forms (glob, `@group`, `kind`)                                       |
| Conditions       | 8                                | 3 (`rust`, `os-specific`, `platform`)                                              |
| Browser suites   | a default `when`, `narrow`       | implied reach, an optional `when`                                                  |
| Rules file       | 457 lines                        | 300 lines (Appendix A)                                                             |
| Cost over 40 PRs |                                  | +36 jobs, +432 runner-minutes (+2.3%), no wall time                                |

What stays in code is the graph, the facts no manifest declares (files crates
read by path, what build scripts compile, the inputs `scenarios.json` names, the
harness's `testDir`, lockfile closures). `tools ci explain` names the fact
behind each package a file reaches.

## Recommendation

Adopt steps 1, 2, 4 and 5 as proposed, step 3 with two verbs, and the four tools
in step 6. In order:

1. Restate the rules in the simpler shape (steps 1, 2 and 4, two verbs), with
   the replay as a test that the plans match today's except where this note
   says.
2. Drop `from`, `narrow` and `facts`, each with its table cases.
3. The tools.

## Appendix A: the recommended rules file

```json
{
  "$schema": "./ci-rules.schema.json",
  "description": "What the Projections workflow runs for a change. Each changed file gets one class: the first file rule whose paths match it, or, when none does, `code` if a workspace or crate contains or reads it and `full` otherwise. A full run runs every job. Otherwise each job runs when its `when` holds. See CONTRIBUTING.md#what-ci-runs.",
  "full": {
    "description": "Pushes to main, the nightly run, a manual run and the ci:full label run every job",
    "events": ["push", "schedule", "workflow_dispatch"],
    "labels": ["ci:full"]
  },
  "files": [
    {
      "description": "Lockfiles: a change to the workspaces and crates whose resolved dependencies changed; everything when the root's own tooling changed",
      "paths": ["package-lock.json", "Cargo.lock"],
      "class": "lockfile"
    },
    {
      "description": "CI itself, a toolchain, a root manifest or the repository's tooling",
      "paths": [
        ".github/workflows/**",
        ".github/actions/**",
        ".github/ci-rules.json",
        ".github/ci-rules.schema.json",
        "package.json",
        "Cargo.toml",
        "rust-toolchain.toml",
        ".node-version",
        ".npmrc",
        ".cargo/**",
        ".config/nextest.toml",
        "tools/cli/**",
        "tools/scripts/**"
      ],
      "class": "full"
    },
    {
      "description": "Documentation a crate embeds or a generator reads or writes: the Linux checks, which run every crate's tests and generator's check. A test fails when a crate or generator reads a documentation file this list misses.",
      "paths": [
        "docs/agents/**",
        "docs/reference/**",
        "docs/builtins/**",
        "docs/setup/**",
        "docs/images/comparators/**",
        "packages/cli/src/**/*.md",
        "packages/extractors/**/README.md",
        "examples/comparators/priority-order/README.md",
        "notices/README.md",
        "packages/host/vscode-ui/THIRD_PARTY_NOTICES.md",
        "LICENSE"
      ],
      "except": ["**/fixtures/**", "**/test/**", "**/tests/**", "**/templates/**", "**/snapshots/**", "**/golden/**", "**/vendor/**"],
      "class": "checks"
    },
    {
      "description": "Configuration only the checks read, the GitHub Action and the release configuration: the Linux checks, and the jobs whose conditions name them",
      "paths": [
        ".considered.yaml",
        ".oxfmtrc.json",
        "eslint.config.js",
        ".portability.yaml",
        "rustfmt.toml",
        ".github/actionlint.yaml",
        ".github/dependabot.yml",
        ".github/projections/**",
        ".projections-bookmarks.json",
        "action.yml",
        "dist-workspace.toml",
        ".github/release-build-setup.yml"
      ],
      "class": "checks"
    },
    {
      "description": "Documentation: Markdown outside test data and templates, and docs/",
      "paths": ["**/*.md", "docs/**", ".github/CODEOWNERS", ".github/ISSUE_TEMPLATE/**"],
      "except": ["**/fixtures/**", "**/test/**", "**/tests/**", "**/templates/**", "**/snapshots/**", "**/golden/**", "**/vendor/**"],
      "class": "docs"
    }
  ],
  "groups": {
    "crates": {
      "description": "Every Cargo crate",
      "include": [
        {
          "kind": "crate"
        }
      ]
    },
    "engine": {
      "description": "The core Engine and the crate Verus proves",
      "include": ["packages/engine", "packages/engine/verified"]
    },
    "coverage": {
      "description": "The crates whose coverage thresholds `npm run test:rust:coverage` enforces (a test keeps this list and the script's the same)",
      "include": ["packages/engine", "packages/comparators/default"]
    },
    "browser-only": {
      "description": "Workspaces whose code runs only in a browser",
      "include": ["packages/renderers/**", "packages/host/**", "tools/storybook", "examples/renderers/**"]
    },
    "not-browser-only": {
      "description": "Workspaces and crates with code outside a browser",
      "include": ["**"],
      "exclude": ["@browser-only"]
    },
    "cli": {
      "description": "The CLI",
      "include": ["packages/cli"]
    },
    "sdk": {
      "description": "The SDK, @githubnext/projections",
      "include": ["packages/sdk"]
    },
    "inspector": {
      "description": "The Inspector, whose stage the renderer harness draws every renderer in",
      "include": ["packages/host/inspector"]
    }
  },
  "conditions": {
    "rust": {
      "description": "Rust: a Rust source, manifest, lockfile or toolchain, or any file of a crate",
      "when": {
        "any": [
          {
            "changes": ["**/*.rs", "**/Cargo.toml", "**/Cargo.lock", "rust-toolchain.toml"]
          },
          {
            "touches": "crates"
          }
        ]
      }
    },
    "os-specific": {
      "description": "Rust, the GitHub Action or the CLI's packaging scripts",
      "when": {
        "changes": ["**/*.rs", "**/Cargo.toml", "**/Cargo.lock", "rust-toolchain.toml", "action.yml", "packages/cli/scripts/**"]
      }
    },
    "platform": {
      "description": "Code that runs outside a browser: Rust, the GitHub Action, or a workspace or crate with code outside a browser",
      "when": {
        "any": [
          {
            "if": "rust"
          },
          {
            "changes": ["action.yml"]
          },
          {
            "touches": "not-browser-only"
          }
        ]
      }
    }
  },
  "jobs": {
    "docs": {
      "description": "Documentation alone: format, lint, file standards and links, with no build",
      "when": "docsOnly"
    },
    "public-product": {
      "description": "The full check, Node and Rust suites, generated documentation and the self-projection",
      "matrix": [
        {
          "name": "ubuntu-latest",
          "description": "Every change but documentation alone",
          "when": {
            "not": "docsOnly"
          },
          "with": {
            "os": "ubuntu-latest",
            "part": "all"
          }
        },
        {
          "name": "macos-latest, Rust",
          "description": "Rust, the GitHub Action or the CLI's packaging scripts",
          "when": {
            "if": "os-specific"
          },
          "with": {
            "os": "macos-latest",
            "part": "rust"
          }
        },
        {
          "name": "macos-latest, Node",
          "description": "Rust, the GitHub Action or the CLI's packaging scripts",
          "when": {
            "if": "os-specific"
          },
          "with": {
            "os": "macos-latest",
            "part": "node"
          }
        }
      ]
    },
    "verus": {
      "description": "Verus proofs of the Engine's verified crate",
      "when": {
        "touches": "engine"
      }
    },
    "windows": {
      "description": "The Rust suites on Windows",
      "when": {
        "if": "rust"
      }
    },
    "windows-node": {
      "description": "The Node suites and file-system checks on Windows",
      "when": {
        "if": "platform"
      }
    },
    "windows-integration": {
      "description": "The CLI's browser suite, a renderer smoke test, the VS Code extension and the GitHub Action on Windows",
      "when": {
        "if": "platform"
      }
    },
    "package": {
      "description": "@githubnext/projections as published, with a renderer the CLI scaffolds and checks: Rust, the SDK, or the CLI and what it depends on",
      "when": {
        "any": [
          {
            "if": "rust"
          },
          {
            "reaches": "sdk"
          },
          {
            "reaches": "cli"
          }
        ]
      }
    },
    "release-config": {
      "description": "The release workflow matches dist-workspace.toml, and dist plans the release",
      "when": {
        "changes": ["dist-workspace.toml", ".github/release-build-setup.yml", "**/Cargo.toml"]
      }
    },
    "coverage": {
      "description": "The Engine's and default comparator's coverage thresholds",
      "when": {
        "reaches": "coverage"
      }
    },
    "mutants-diff": {
      "description": "Mutation testing of the changed files .cargo/mutants.toml examines (a test keeps these globs and its examine_globs the same)",
      "when": {
        "changes": ["packages/engine/src/**/*.rs", "packages/comparators/default/src/**/*.rs"]
      }
    },
    "actions-lock": {
      "description": "The workflow dependency lockfile verifies upstream: in full runs only",
      "when": "never"
    }
  },
  "browser": {
    "description": "Each workspace with a test:browser script runs when the change reaches it or a workspace its script builds, or when its own `when` holds. Those with shards run in their own jobs; the rest together in `browser (rest)`.",
    "suites": {
      "packages/host/core": {
        "description": "The host's default UI",
        "shards": 3
      },
      "tools/storybook": {
        "description": "The Storybook",
        "shards": 3
      },
      "packages/renderers/harness": {
        "description": "Every built-in renderer in the Inspector's stage; the renderers are under its Playwright testDir, so a change to one reaches it",
        "when": {
          "reaches": "inspector"
        },
        "shards": {
          "chromium-desktop": 3,
          "webkit-desktop": 4,
          "chromium-mobile": 2,
          "webkit-mobile": 3
        },
        "macos": {
          "webkit-desktop": 2
        }
      },
      "packages/host/inspector": {
        "description": "The Inspector, against the CLI's backend, exploring and extracting",
        "when": {
          "reaches": "cli"
        },
        "shards": 2
      },
      "examples/renderers/minimal": {
        "description": "The minimal example renderer, against the CLI's backend",
        "when": {
          "reaches": "cli"
        }
      }
    }
  }
}
```

## Appendix B: the full proposal, where it differs

With one package verb, these conditions and jobs become:

```json
{
  "rust": {"when": {"any": [{"changes": ["**/*.rs", "**/Cargo.toml", "**/Cargo.lock", "rust-toolchain.toml"]}, {"reaches": "crates"}]}},
  "platform": {"when": {"any": [{"if": "rust"}, {"changes": ["action.yml"]}, {"reaches": "not-browser-only"}]}},
  "verus": {"when": {"reaches": "engine"}}
}
```

Replayed, this adds the Windows Rust, Node and integration jobs to #95, #99,
#107, #126, #136 and #140 (host, kit and renderer SDK changes) and `windows` to
#104 and #139, as well as everything the recommended file adds.
