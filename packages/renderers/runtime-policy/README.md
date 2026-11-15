---
description: Built-in renderer for runtime security policies
---

# Runtime security policy renderer

`@githubnext/projections-renderer-runtime-policy` presents runtime security
policies, or a comparison of two revisions of them, written in the
[runtime policy model](../../../docs/models/runtime-policy-model.md): what each
policy applies to, then one lane per hook holding every policy's rules there. It
handles the definition renderer name `runtime-policy` and is built with the
[renderer kit](../kit/README.md). The
[`tetragon-policies`](../../extractors/tetragon-policies/README.md) extractor
targets it; any extractor writing the model can.

## What it shows

- **A security summary in the host's summary bar**, along the bottom of every
  view: policies, hooks and rules (and workloads, kernel profiles and the agent
  configuration, when the extraction has them), then how many rules enforce,
  with its change in a comparison (`1 enforcing rule +1`). With the
  [runtime policy comparator](../../comparators/runtime-policy/README.md), a
  comparison also counts what changed in security terms, most severe first, each
  with its icon and filtering to the changes it names: `1 newly enforced`,
  `1 scope broadened`, `1 hook no longer covered`. The view draws no summary of
  its own; probes and the subjects rules match are structure, not figures.
- **Agent and kernels**, when the extraction has
  [deployment facts](../../../docs/models/runtime-policy-model.md#deployment-facts).
- **Policies**: name, resource, mode and the nodes that load it, and the
  workloads it applies to.
- **Workloads**, when the extraction has them, with the policies that cover
  each, whether each enforces or observes, and on which containers.
- **Hook lanes**, grouped by what the hook observes (credentials, processes,
  files, network, kernel modules, BPF, namespaces, user space, other), each
  holding every policy's rules at that hook: when each acts, what it does, and
  which binaries or workloads it applies to.

## Layout and type

- Every section (the agent and kernels, the policies, the workloads, each
  category of hooks) is a titled panel, the kit's `Group`, as text diff's
  outputs are: raised on the stage, edged, its title in a header band inside its
  edge, in the UI font, after a muted icon for its subject: a server for the
  agent and kernels (the nodes the policies run on), a shield for policies, a
  box for workloads, and for the categories a key (credentials), a terminal
  (processes), a file, a globe (network), a puzzle piece (kernel modules),
  binary digits (BPF programs), layers (namespaces and mounts), an application
  window (user space) and an ellipsis (other). It holds one table that reaches
  its sides and is clipped to its corners, so fills, selection and focus follow
  them. Rows sit between dividers on one column grid (sign · rule · effect ·
  applies to · change, through subgrid), under a quiet column-header strip like
  text diff's Before and After strip, with the same column widths in every
  panel. A category's table is grouped by hook: each hook's lane opens with its
  header row, then its rules' column headers, and lanes are ruled off by the
  divider. Below 640px the columns stack under each row, the column headers are
  hidden, and the applies-to column labels itself.
- The selection button covers its whole row; its focus ring is drawn inside the
  row's corners. Rows are parts of their group: hover tints them, selection
  tints them with an accent bar. A selected hook rings its lane.
- Two sizes (row text and secondary text), one muted tone, and weight only for
  names and headings. Human text is in sentence case, never transformed to
  capitals; data is shown verbatim.
- The extractor's text is
  [text with inline code](../../../docs/models/runtime-policy-model.md#text),
  drawn with the kit's `Prose`: identifiers, paths, addresses, values and label
  selectors in the theme's monospace font, the connecting English proportional.
- Surfaces are the kit's: panels are raised with a divider edge and a header
  band, column headers are a lighter band, warnings are inset blocks; rows are
  separated by the quieter border, a category's hook lanes by the divider.
  Hover, focus and selection are the SDK's item ring (panel rows and hook lanes,
  over their own edge) and the kit's part tint (`pk-part`: rules, probes and
  chips). Changed rows, probe regions and lanes are kit change runs
  (`pk-region-run`), as text diff marks changed lines: neighbouring rows changed
  the same way join into one run.
- **Warnings** (a policy the repository's CRD rejects, a policy that won't load
  because the agent's policy filter is off, a hook or `Override` a kernel
  profile can't support) are edged blocks labelled with the warning icon and the
  word "Warning" under the item they concern. They describe the presented
  revision, so they stay at every point of a comparison, independent of change
  highlighting.

## Comparisons

The renderer declares `diff` (default) and `side-by-side`. The content is lists
and cards, so a scrubbed transition would only pop rows in and out; it declares
no `animated` or `swipe` mode.

- **Diff.** One static view draws every policy, hook, rule and subject of both
  revisions once, in place, with a sign in the gutter (`+`, `−`, `~`). A
  modified item shows its old value struck before its new one, behind text
  diff's removed and added word highlights while the change is emphasized: a
  rule's conditions or effect, a policy's mode or nodes. A scope change is the
  old workloads chip struck and the new one beside it.
- **Side by side.** Each pane draws one revision.
- **Change marks.** A changed row is filled and edged (a border, with a thicker
  leading edge) in its change's hue, and its change column states the change as
  a stack of icon-led lines with no separators: the change first, a badge and a
  word (`Removed`), then one line per interpretation of the comparator's, an
  outline icon and words (`No longer covered`): an interpretation is a note, not
  a change kind. Assistive technology reads the stack as one sentence
  (`Removed, no longer covered`). The column's heading (`Change`) shows as the
  statuses under it do, so a lane whose rows inherit its mark, or a table with
  no changes, has no heading over an empty column. Icons come from the host's
  shared icon vocabulary (kit `Icon`), so hosts can restyle them, and always
  stand beside their words. Enforcing effects carry the `enforced` icon
  (`unenforced` when monitor mode elides them). An added or removed hook or
  probe marks its whole region once; the rows inside inherit it (struck when
  removed) without a second fill, and state their status only to assistive
  technology. Marks follow the host's highlighting, so both endpoints and
  highlighting off carry none, and the change column is laid out on every
  changed row so status appearing never moves anything.
- **Identity comes from the comparison.** Nothing is matched by label.

Without the comparator (a definition that uses the default one) every change is
still marked, with old and new values; only the interpretation words and finding
counts are absent. Hosted views run the comparator file from the pull request's
base, as the CLI and VS Code do.

## Accessibility

Policies, hooks, probes and rules have their own selection buttons
(`aria-pressed`); subjects are chips with their own. Signs are decorative: a
changed item states its change in its change column, or for assistive technology
while highlighting is off or when it inherits its region's change. Warnings are
labelled "Warning" in text. A chip that arrives or leaves says so (`Added:`,
`Removed:`). Column headers are visual only; every row names its own parts. Long
paths wrap rather than overflow. Nothing moves.

## Development

```sh
npm run build -w @githubnext/projections-renderer-runtime-policy
npm test -w @githubnext/projections-renderer-runtime-policy
npm run test:browser -w @githubnext/projections-renderer-harness -- runtime-policy/
```

`scenarios.json` presents the `tetragon-policies` extractor's golden
extractions, with and without the comparator, and runs the built-in renderer
checks on them.
