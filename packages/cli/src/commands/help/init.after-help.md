```text
Examples:
  projections init service-map                                 starter extractor, built-in graph renderer
  projections init service-map --language python --title "Service map"
  projections init service-map --renderer custom               add a custom renderer to it later
  projections init deps --extractor workspace-dependencies --renderer custom
  projections init release-jobs --extractor github-actions-jobs --input workflowPath=.github/workflows/release.yml
  projections init flags --command '["ruby","tools/flags.rb"]' --renderer tree
  projections init                                             only the agent skill
  projections init --claude                                    the skill, linked for Claude Code too
  projections init --skills-dir .github/skills                 the skill in another skills directory
  projections init service-map --no-skill                      the projection without the skill
```

Then: projections check -p ID --trust, and projections help authoring.

@githubnext/projections, the package custom renderers depend on, is not on npm
yet: a custom renderer depends on the tarball attached to this CLI's GitHub
release, by URL:
https://github.com/githubnext/projections/releases/download/v<version>/githubnext-projections-<version>.tgz.
If you can't download release assets, add the repository as a Git submodule,
build and pack the package there (docs/guides/develop-a-renderer.md, "Install
@githubnext/projections") and set PROJECTIONS_RENDERER_PACKAGES to the directory
holding the tarball; it takes precedence. A development build from a clone (npm
run tools -- install there) instead references the tarball packed there,
dist/dogfood/githubnext-projections.tgz, with a file: specifier.
