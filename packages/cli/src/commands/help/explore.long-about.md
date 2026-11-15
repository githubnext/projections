Finds the projections that apply to this repository from the files it holds
(package manifests, database models, infrastructure, workflows, API surfaces and
more) and offers them as trial definitions, writing nothing. It prints them; the
VS Code extension's Explore view (Projections: Explore Repository) tries each on
recent changes, and --sweep does in the terminal. Keep the useful ones with
projections adopt, then add them to CI (projections help agents ci).
