# Add Projections to CI

Once you've [adopted](quick-start.md#step-3-adopt-the-useful-ones) the
projections worth keeping, add them to your CI: every pull request and push then
gets a summary of how its projections changed, without anyone running anything
locally. Your repository's own CI produces them with one step, the Projections
GitHub Action. It writes the summary to the workflow run (and, if you like, to a
pull request comment) and uploads the documents as an artifact, which you can
[review locally or in a hosted view](#reviewing-the-results).

Where that step belongs depends on your CI, so nothing writes it for you. Your
coding agent can read your workflows, propose where it fits and show you the
change before writing it. Paste this into it:

```prompt Copy Add to CI prompt
Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints.
```

In VS Code, **Add to CI…** in the Explore view (or **Projections: Add to CI…**)
hands the same prompt to your agent or opens this page. To do it yourself, read
on.

## The step

```yaml
- uses: githubnext/projections@v0
```

It needs a checkout with full history and no persisted token:

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0 # both the merge base and the head must be in the checkout
    persist-credentials: false # extractors never see the token
```

- **`fetch-depth: 0`.** A pull request is compared from its merge base to its
  head, so both commits and the history between them must be in the checkout. A
  shallow checkout fails with `Commit … is not in the checkout`. The only cost
  is a slower checkout in a very large repository.
- **`persist-credentials: false`.** It keeps the token out of `.git/config`, so
  no repository code in the job can read it. It is required with
  [`trust: true`](#trust), which runs a pull request's own code; without trust
  the Action runs no repository code, so it adds nothing to what the job's own
  steps already expose.
- **Events.** The Action runs on `pull_request` and `push`. Any other event
  (`merge_group`, `workflow_dispatch`, `schedule`, `release`) fails the step,
  and `pull_request_target` is refused because it would run pull request code
  with the base repository's secrets. Run it on pushes to the default branch as
  well as pull requests: a pull request then reuses its merge base's artifact
  from that push's run instead of extracting the base again (see
  [what a pull request installs](#what-a-pull-request-installs)).
- **Permissions.** `contents: read` is enough; uploading the artifact needs no
  extra permission. See [Permissions](#permissions) for the options that write.

The Action extracts every projection the repository defines, so adopting another
later needs no change to CI.

## Where it goes

**A step in the job that already builds the code** is usually right. A
repository with one CI workflow (install, build, test and lint, say) has already
set up its toolchains and installed its dependencies there; a separate workflow
would do it all again, which is the expensive part. Add the step after the
install and build steps, change that job's checkout as above, and guard the step
when the workflow runs on other events:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
  merge_group:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # added for Projections
          persist-credentials: false # added for Projections
      - uses: actions/setup-node@v6
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: githubnext/projections@v0 # added: after the build, before the tests
        if: github.event_name == 'pull_request' || github.event_name == 'push'
      - run: npm run lint
      - run: npm test
```

Things to check when joining an existing job:

- **Before or after the tests.** A failed step skips the steps after it. Placed
  after the build and before the tests, the projections are reported even when a
  test fails; placed last, they wait for the tests and are skipped when one
  fails. Add `if: ${{ !cancelled() }}` (with the event guard) to run it after
  failed tests too.
- **Steps that change tracked files.** On a push, the Action extracts the
  checked-out commit in place, with the job's installed dependencies and build
  output, as long as its tracked files are unmodified (untracked and ignored
  files such as `node_modules` and `dist` are fine). Put it before a step that
  rewrites tracked files (a formatter that writes, a version bump).
- **Steps that push.** A job that commits or pushes with the checkout's
  credentials breaks with `persist-credentials: false`. The narrowest fix is to
  give that step its own token (for example `git push` to
  `https://x-access-token:${{ github.token }}@github.com/…`, or an action that
  takes a `token` input). If the job doesn't need [trust](#trust), you can keep
  its checkout's credentials instead; otherwise put Projections in its own job.
- **Matrix jobs.** Each matrix entry would run the step and upload an artifact
  of the same name, which fails. Run it in one entry only:
  `if: matrix.os == 'ubuntu-latest' && matrix.node == 24`, say, or put it in a
  job without a matrix.
- **Several workflows.** Choose the job whose setup the projections' extractors
  need: `projections list` says which run repository code (and need
  [trust](#trust)), and `projections doctor` names the toolchains and declared
  prepare steps they use. A projection whose extractors only read files needs no
  setup at all, so any job, or its own workflow, will do.
- **A monorepo project.** For a project in a subdirectory, set
  `working-directory` to it, in the job that builds that project.

**A workflow of its own** is the fallback: when no job installs what the
extractors need, every projection only reads files, or the build job can't take
the step (it pushes and needs trust, say). Save it as
`.github/workflows/projections.yml`:

```yaml
name: Projections
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  projections:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # both the merge base and the head must be in the checkout
          persist-credentials: false # extractors never see the token
      - uses: githubnext/projections@v0
```

Adapt it as you would any workflow: your default branch, your runner
(`runs-on`), path filters. If its projections run your toolchain, add the setup
and install steps it needs before the Projections step, or declare them as
[prepare steps](../runner/environments.md) in
`.github/projections/environment.json`.

## What a pull request installs

The Action compares a pull request's merge base with its head. Neither is the
commit `actions/checkout` checks out for a pull request: that is GitHub's merge
of the head into the base (`refs/pull/<number>/merge`). So:

- **The merge base** is reused, not extracted, when the merge base's own CI run
  succeeded and uploaded a `projections` artifact: usually the push run on the
  default branch. Only a run of the same workflow file, in this repository, for
  a push or a pull request from this repository counts (a fork's pull request
  runs its own workflow files, so its artifact is never reused). The Action
  downloads it and the CLI verifies each extraction, labelling it imported, not
  official, since the CLI's step holds no token to authenticate it. This is why
  the step should run on pushes to the default branch, in a run that succeeds;
  artifacts also expire after `retention-days`.
- **Projections that only read files** read both commits from Git objects:
  nothing is installed for them.
- **Projections that run your toolchain** (with [trust](#trust)) need each
  commit on disk, so the CLI extracts it in a copy. Without prepare steps, the
  copy borrows the dependencies the job installed: exact when the commit's
  lockfiles match the checkout's, otherwise labelled _approximate_ with the
  lockfiles that differ. Build output is not carried into the copy. With
  [prepare steps](../runner/environments.md) declared, the copy runs them
  instead: an install of its own for each commit extracted.

In the common case, a step in the build job installs nothing again: the merge
base comes from the default branch's artifact, and the head borrows the job's
dependencies, whose lockfiles are the head's unless the base branch changed them
too. A pull request that changes a lockfile, when its merge base has no
artifact, labels the base _approximate_ rather than installing again; declare
prepare steps if you'd rather pay for that install than see the label. On a
push, the commit is the checkout, so it is extracted in place with everything
the job set up.

## How it compares

On `pull_request`, the Action compares the merge base of the pull request's base
and head with its head
(`projections compare --all <merge-base>..<head> --definition base --json`), so
the base's projection definitions explain the change, as in a local
`projections compare`. On `push`, it shows every projection of the pushed commit
(`projections show --all <commit> --json`). It uploads one document per
projection and a manifest, `projections.artifact.json`, as an Actions artifact
named `projections`. The
[artifact contract](../contracts/saved-documents.md#ci-artifacts) describes it.

The Action installs the CLI from this repository's GitHub Releases for the
runner's OS and architecture, and checks the binary against its `.sha256` file
in the release and its build provenance attestation (`gh attestation verify`)
before running it. By default it installs the release that matches the Action's
own version tag: `@v0.1.0` installs v0.1.0, and `@v0` the newest stable v0
release, never a v1. Each stable release moves its major version's tag (`v0`) to
itself; a commit SHA, branch or `@latest` installs the latest release.

<!-- prettier-ignore -->
| Input | Default | Meaning |
|---|---|---|
| `trust` | `false` | Pass `--trust`, so extractors that run repository code run. See below. |
| `summary` | `true` | Write each projection's result, steps and changes to the job summary. |
| `comment` | `false` | Also post the summary as one pull request comment, updated on each run. Needs `pull-requests: write`. |
| `retention-days` | repository default | How long GitHub keeps the artifact. |
| `attest` | `false` | Attest the artifact's manifest with [GitHub artifact attestations](#attesting-the-artifact). Needs `id-token: write` and `attestations: write`. |
| `fail-on-error` | `false` | Fail the job when a projection fails. By default failures are reported per projection, in the summary and as annotations, and the job succeeds. |
| `snapshots` | none | Projection IDs to render as PNG [snapshots](#snapshots), light and dark. |
| `snapshots-commit`, `snapshots-path` | `false`, `.github/projections/snapshots` | On pushes to the default branch, commit the snapshots for embedding in a README. Needs `contents: write`. |
| `snapshots-branch` | none | On pull requests from this repository, commit the before and after snapshots to this dedicated branch so the comment shows them. Needs `contents: write`. |
| `version` | the Action's version | A CLI release such as `v0.1.0`, a major version such as `v0` (its newest stable release), or `latest`. |
| `build-from-source` | `false` | Build the CLI from the Action's source instead (needs Rust), for testing unreleased versions. |
| `working-directory`, `artifact-name`, `hosted-url`, `token`, `cli-repository` | | Less common settings, documented in `action.yml`. |

## Permissions

The step needs only `contents: read`; uploading an artifact needs no extra
permission. Add `pull-requests: write` only for `comment: true`, and
`contents: write` only for `snapshots-commit` or `snapshots-branch`. In an
existing workflow, grant them to the job that runs the step (`permissions:`
under the job), not the whole workflow. With `trust: true` the job must keep
only read permissions and no secrets, as [Trust](#trust) explains. Pull requests
from forks never get a writable token, so they get no comment, but their job
summary and artifact are still produced.

### Attesting the artifact

With `attest: true` the Action attests the artifact's manifest,
`projections.artifact.json`, which lists every document's SHA-256, with
`actions/attest`. A downloaded copy can then be authenticated:
`projections show <commit> --ci --artifact DIR` runs `gh attestation verify` on
its manifest and treats it as the commit's official extraction only when the
attestation names a run of this repository's Projections workflow for a push or
a pull request from this repository. Without an attestation, an imported
directory is reused but labelled imported. It needs `id-token: write` and
`attestations: write` on the job, and artifact attestations available to the
repository (public repositories, or private ones on GitHub Enterprise Cloud).
Pull requests from forks skip it: they get no `id-token`, and their runs are
never the repository's own CI output.

## Snapshots

With `snapshots`, the Action also renders the listed projections as PNG images
with the real renderer, light and dark, using
[`projections show --png`](../runner/commands.md#images) in the runner's
installed Chrome (GitHub-hosted runners have it; set `browser` otherwise). It
renders the documents it just collected, so no extractor runs again, and the
step that renders gets no token. A push renders `<id>.light.png` and
`<id>.dark.png` of the pushed commit; a pull request renders
`<id>.before.<theme>.png` (the merge base) and `<id>.after.<theme>.png` (the
head). The images and a `snapshots.json` index are uploaded as a separate
artifact, `projections-snapshots`, so the `projections` artifact holds exactly
the files its manifest lists. A snapshot that fails is a warning, never a failed
job. A projection's custom renderer is repository code, so it draws snapshots
only with `trust: true`; without it the snapshot uses the built-in renderer for
the projection's schema, with a note in the log.

```yaml
permissions:
  contents: write       # snapshots-commit and snapshots-branch
  pull-requests: write  # comment
# …
      - uses: githubnext/projections@v0
        with:
          snapshots: architecture, files
          snapshots-commit: true                # pushes to the default branch
          snapshots-branch: projections-snapshots # pull request comments
          comment: true
```

**In a README.** With `snapshots-commit: true`, each push to the default branch
commits changed images to `snapshots-path` (default
`.github/projections/snapshots`) through the GitHub API, like the original
repo-visualizer Action's `should_push`. Unchanged images make no commit, and
nothing is committed when the branch has moved on in the meantime. Commits made
with the workflow's `GITHUB_TOKEN` don't start other workflows. Embed them so
they follow the reader's theme:

```html
<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset=".github/projections/snapshots/files.dark.png"
  />
  <img
    alt="Repository files"
    src=".github/projections/snapshots/files.light.png"
  />
</picture>
```

**In pull request comments.** A comment can only show images GitHub can fetch,
and an Actions artifact can't be shown inline. With `snapshots-branch`, a pull
request from this repository commits its images under `pull/<number>/` on that
dedicated branch (created without history when it's missing, never the base or
head branch), and the comment shows before and after thumbnails pinned to that
commit, switching with the reader's theme. Readers need read access to the
repository, as for the code. Pull requests from forks get a read-only token, and
without `snapshots-branch` nothing is committed: then the comment links to the
snapshots artifact instead. The branch grows with each run that changes an
image; delete it to start over.

## Reviewing the results

**The job summary.** Each run's summary says what was compared (a pull request's
merge base and head, or the pushed commit) and lists every projection with its
result. For each comparison it then tells the change in the order the comparator
presents it: each step, with its changes in words (`Added entity …`,
`Renamed relationship … to …`) and any summaries the comparator gave. A failed
projection shows its diagnostics; failures are also annotations on the run. With
`comment: true`, the same summary is the pull request's comment, updated on each
run, with the snapshots when there are any.

**From the pull request.**
[`projections pr <number>`](../runner/pull-requests.md) reproduces a pull
request's comparisons locally, from its merge base to its head with the base's
definitions, without trusting its code; `--output FILE` saves the review for
later inspection.

**In VS Code (alternate path).** If you use the VS Code extension, download the
run's `projections` artifact, unzip it, and open a projection's document,
`projections/<id>.json`, with **Projections: Open Artifact…** (or from the
Explorer's context menu). It presents the saved comparison or extraction as it
was saved and runs nothing; its provenance, including whether it calls itself
official, is the document's own claim.

**A hosted view.** The artifact follows a
[documented contract](../contracts/saved-documents.md#ci-artifacts), so a
service can show it too. Set `hosted-url` to such a service's origin, for
example `https://projections.example`, and the summary and the comment link to
its view of the pull request or commit.

## Trust

The Action follows the same [trust rule](../guides/how-it-works.md#trust) as the
CLI. Built-in extractors that only read files always run. Custom extractors, and
built-in ones that run your toolchain, run only with `trust: true`; without it
they appear as failed projections that explain why. Custom renderers are
repository code too: [snapshots](#snapshots) use them only with `trust: true`.

On a pull request, `trust: true` runs code from the pull request's head in CI.
Use it only when the workflow is the plain `pull_request` event (never
`pull_request_target`), has no secrets and only read permissions, and checks out
with `persist-credentials: false`, which is how GitHub already runs workflows
for pull requests from forks. A build job that tests pull requests already runs
their code, so adding the step there with `trust: true` runs nothing it didn't
already trust, under the same conditions. Nothing that reads the artifact runs
any of it: the summary, **Projections: Open Artifact…** and hosted views only
present the saved documents.
