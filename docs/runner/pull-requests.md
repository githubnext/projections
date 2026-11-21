# Untrusted pull request review

```sh
projections pr 42 -R example/application --id files --output /tmp/new-pr-review.json
projections pr https://github.com/example/application/pull/42
```

This command lets you inspect a GitHub pull request without running any code
from it. Pass either a pull request number or a full URL. A URL identifies the
host and repository automatically; for a bare number, specify
`-R [HOST/]OWNER/REPO` (defaulting to `github.com`) or let the CLI fall back to
your checkout's `origin` remote. Repository names may start with `.`, `_`, or
`-` (for example `owner/.github`), while extra path segments and bare `.` or
`..` names are rejected.

The CLI fetches the pull request with bounded `gh api` and Git invocations,
using your existing GitHub authentication only to download the data. There is no
`--trust` flag. The resulting `projections.pull-request` (version 0) document
records the exact base and head commits along with their computed merge base,
then compares merge-base to head **untrusted**, using the merge base's
definitions (`"definition": "base"`).

`changedProjections` lists every projection whose definition or component code
the pull request modifies, along with its notices; any projection newly added by
the pull request is shown at the head revision alone (`head-only`). Parser-only
installed adapters can run normally, whereas repository executables and
tool-running adapters report explicit per-item `TRUST_REQUIRED` errors without
discarding valid sibling projections.

By default the command prints each comparison as text. Pass `--json` to print
the review document, or `--output FILE` to write it to a new file that you can
open in VS Code with **Projections: Open Artifact…**
(`serve --stdio --document FILE`). Note that controlled transport tests do not
imply live GitHub authentication acceptance.

Fetched Git objects go into a fresh, disposable bare cache rather than your
checkout or refs. `--cache` selects only the existing parent directory for that
cache; the cache itself is deleted after success, failure, or cancellation and
never stores credentials. Git hooks, submodules, global Git config, and external
or file protocols are all disabled.

Each acquisition subprocess has a 30-second limit and bounded output, with a
60-second overall deadline. A 100 ms cache monitor and a final verification pass
reject repositories over 256 MiB or 50,000 entries. Because the monitor is not a
filesystem quota, a hostile transfer can briefly exceed the limit before being
terminated. Large repositories fail rather than returning truncated extractions.

Before running any extraction, the CLI verifies that the PR metadata matches the
exact target and immutable commits, that fetched refs point to those commits,
and that a merge base exists. Transport authentication environment variables are
stripped before extraction—even if a projection asks for them in its allowlist.
The trusted operator's `GIT_EXEC_PATH` is kept during acquisition so relocated
Git installations can find their HTTPS helpers, while Git config, redirection,
and loader environment variables remain isolated; `GIT_EXEC_PATH` is also
stripped before extractors run and is never recorded in artifacts.
