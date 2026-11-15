# One service catalog, two extractor languages

Copy this directory into a new tiny Git repository and commit it. The Node and
Python extractors independently implement `ExtractorRequest` stdin and
`Extraction` stdout without any Projections SDK or language rewrite. They model
declared services/dependencies, not guessed source regexes or runtime discovery.
Evidence remains repository-relative.

With the built CLI on PATH:

```sh
git init
git add .
git -c user.name=Example -c user.email=example@example.invalid commit -m baseline
projections show -p services-node --trust
projections show HEAD -p services-node --trust --output /tmp/node.json
projections show HEAD -p services-python --trust --output /tmp/python.json
```

The first command prints the services and their dependencies as text; the saved
documents of both have the same extraction digest. Add a service/dependency in
`services.json`, commit, and run:

```sh
projections compare HEAD~1..HEAD -p services-node --trust
projections compare HEAD~1..HEAD -p services-python --trust --json
```

Formatting-only edits produce no changes. A changed dependency or service
produces a meaningful change. A comparison runs the base revision's definition
and extractor script against both revisions; the scripts read the examined
revision through `request.repository.root`. Each definition declares its script
in `extractor.sources`, so a changed script changes the definition digest and a
saved extraction is compared only with one made by the same script. Use
`--definition head` to apply the head revision's version instead. Review the
extractor before granting `--trust`. Python 3 and Node >=26.12.1 are explicit
prerequisites; no dependency install, network request, paid API, credentials or
private runtime is needed.
