# Embedding Projections

## Embedding Projections in your own app

Browser apps present extractions and comparisons with the Projections host. Pick
the layer that fits:

- **Headless core** (`@githubnext/projections-host`): renders the sandboxed
  renderer frames and owns the state: progress, selection, comparison modes,
  settings and renderer controls. You draw the controls, so you decide which
  features to offer.
- **Default UI** (`@githubnext/projections-host/ui`): a complete viewer built on
  the core with shadcn/ui. It is scoped so it doesn't affect your page's styles,
  or your page its styles.
- **VS Code UI** (`@githubnext/projections-host-vscode`): the same viewer built
  with VS Code's own controls (VSCode Elements and codicons), themed from VS
  Code's `--vscode-*` variables so it follows the color theme in a webview.

A host built on the core alone, offering only side by side, with no play button:

```tsx
import {ProjectionStage, useProjection} from '@githubnext/projections-host'

function Review({subject, renderer}) {
  const projection = useProjection({subject, projection: {id: 'deps', title: 'Dependencies'},
    renderers: [renderer], mode: 'side-by-side'})
  return <>
    <input aria-label="Find" value={projection.search} onChange={event => projection.setSearch(event.target.value)} />
    <ProjectionStage projection={projection} labels={{before: 'main', after: 'This pull request'}} />
  </>
}
```

The [host guide](host.md) documents the full API.

## Building commenting on projections

Projections doesn't store comments, but it gives apps everything they need to
let people discuss a projection, for example on a pull request. The same hooks
work for other per-item data, such as lint findings.

**Targets.** A comment is anchored to a _target_: an entity or relationship of
one extraction, named by its own ID, and optionally one of its properties.

```ts
type ProjectionTarget = {
  kind: 'entity' | 'relationship'
  id: string                 // the item's ID in the extraction
  side: 'before' | 'after'   // which extraction of a comparison; 'after' for a single extraction
  path?: string              // a property: an RFC 6901 pointer into the item's data, such as '/owner'
}
```

Like a diff's left and right side, an item that was removed can only be
commented on `before`. Targets never use change IDs or presented rows, which
depend on the comparator and the chosen pair. Store each comment with the
projection ID, the revision, the target, and
`targetDigest(engine, extraction, target)`. A different digest at a later
revision, or no digest at all, tells you the comment is outdated.

**Selection in both directions.** The host reports what a person selects as
`selection {rowId, targets, target?}`: every item the selected row stands for (a
renamed, split or merged row stands for several), and the specific property when
one was chosen. To show a comment's item, call `selectTarget(target)`. It
selects the item in every pane and view, and tells you if it isn't present
(`{status: 'absent', reason}`).

**Markers.** Pass `annotations` (a target with an optional `count`, `label` and
`tone`) and renderers draw a badge on each item; the host's views do too.
Activating a badge selects the item and calls `onAnnotationActivate`.
Annotations whose targets aren't present are listed in `unplacedAnnotations`.

**Placing a popover.** `useProjectionAnchor(projection)` follows where the
selected item is drawn, in page coordinates, through scrolling, resizing and
mode changes.

**Deep links.** `encodeTarget(target)` and `decodeTarget(text)` turn a target
into URL-safe text and back.

A host built on the core alone:

```tsx
import {ProjectionStage, decodeTarget, encodeTarget, useProjection, useProjectionAnchor} from '@githubnext/projections-host'

function Discussed({subject, renderer, comments, onSelectTargets}) {
  const projection = useProjection({
    subject, projection: {id: 'deps', title: 'Dependencies'}, renderers: [renderer],
    annotations: comments.map(comment => ({target: comment.target, count: 1, tone: comment.resolved ? 'done' : 'attention'})),
    onSelectionChange: selection => onSelectTargets(selection?.targets ?? []),
    onAnnotationActivate: ({targets}) => onSelectTargets(targets),
  })
  const anchor = useProjectionAnchor(projection)
  // Show a comment's item, for example from a deep link: ?target=entity.after.payments
  const show = (text: string) => {
    const target = decodeTarget(text)
    return target ? projection.selectTarget(target) : undefined
  }
  return <>
    <ProjectionStage projection={projection} />
    {anchor && <div style={{position: 'fixed', left: anchor.x + anchor.width + 8, top: anchor.y}}>
      Comments on {projection.selection?.targets.map(encodeTarget).join(', ')}
    </div>}
  </>
}
```

The default and VS Code UIs take the same `annotations`, `onAnnotationActivate`
and `onSelectionChange`. Selecting an item opens a detail card anchored to it
over the stage: what changed, field by field (each changed property a selectable
row), where in the code, and its connections. They render your content for the
selection at the end of the card through `renderDetails`, and link its evidence
where your `evidenceLink(location, side)` says, for example to the pull
request's diff. Pass `details="none"` to draw the selection's details yourself.
