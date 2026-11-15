# Untrusted pull request review

```sh
projections pr 42 -R example/application --id files --output /tmp/new-pr-review.json
projections pr https://github.com/example/application/pull/42
```

The pull request is a number or URL. A URL names its host and repository;
otherwise `-R [HOST/]OWNER/REPO` does (the host defaults to `github.com`), or
else this checkout's `origin` remote. It is acquired with bounded `gh api` and
Git argv, using the user's existing GitHub authentication only for acquisition;
there is no `--trust` flag. Repository names may start with `.`, `_` or `-` (for
example `owner/.github`); extra path segments and exact `.`/`..` names are
rejected. The result (`projections.pull-request` version 0) records the exact
base/head commits and computed merge base, and compares merge-base to head with
execution **untrusted**, using the merge base's definitions
(`"definition": "base"`). `changedProjections` lists every projection whose
definition or component code the pull request changes, with the notices; a
projection the pull request adds is shown at the head alone (`head-only`).
Parser-only installed adapters can succeed; repository executables/tool-running
adapters become explicit per-item `TRUST_REQUIRED` errors without discarding
valid siblings. It prints each comparison as text; `--json` prints the review
document, and `--output FILE` writes it to a new file, which the VS Code
extension's **Projections: Open Artifact…** opens
(`serve --stdio --document FILE`). No live GitHub authentication acceptance is
implied by controlled transport tests.

Objects are fetched into a newly initialized disposable bare cache, not the
user's checkout or refs. `--cache` selects only the existing parent directory;
the cache is removed after success, failure or cancellation and never stores
credentials. Git hooks, submodules, global Git config and external/file
protocols are disabled. Each acquisition subprocess has a 30-second limit and
bounded output; overall acquisition has a 60-second deadline. A 100 ms cache
monitor and final verification reject over 256 MiB or 50,000 entries. The
monitor is not a filesystem quota: a hostile transfer can transiently exceed the
bound before termination. Large repositories fail rather than returning
truncated extractions.

Metadata must match the exact target and immutable commits, fetched refs must
match those commits, and the merge base must exist. Transport authentication
environment values are stripped before extraction, even if a projection requests
their names in its allowlist. The trusted operator's `GIT_EXEC_PATH` is retained
only for acquisition so relocated Git installations can find their HTTPS
helpers. Git config/redirection and loader environment remain isolated; the
helper locator is also stripped before extractors run and is not recorded in
artifacts.
