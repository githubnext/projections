# CI example

`projections.yml` runs the [Projections GitHub Action](../../docs/setup/ci.md)
on every pull request and every push to `main`. It compares each pull request
from its merge base to its head with the base's definitions, shows each pushed
commit, uploads the `projections` artifact
([contract](../../docs/contracts/saved-documents.md#ci-artifacts)) and
summarizes each run in its job summary and in one pull request comment. It needs
`contents: read`, plus `pull-requests: write` for the comment. Copy it into
`.github/workflows/`; pin `githubnext/projections` to a release commit if your
organization requires pinned actions. It is the standalone fallback: when a job
in your CI already installs and builds what the extractors need, add the step to
that job instead ([where it goes](../../docs/setup/ci.md#where-it-goes)).
