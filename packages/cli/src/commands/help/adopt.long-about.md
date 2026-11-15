Keep projections `projections explore` proposed. Each is written to
.github/projections/\<id>.json (or .projections/ when the repository uses that),
from the extractor's template, and never over an existing file. The recent
changes each showed the most on are added to .projections-bookmarks.json, so the
team can come back to them. Preview with --dry-run. Then add them to CI with
your coding agent: projections help agents ci.
