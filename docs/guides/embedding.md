# Embedding Projections

## Embedding Projections in your own app

If you want to display extractions and comparisons inside a web app, use the
Projections host. You can pick whichever layer fits how much UI you want to
build yourself:

- **Headless core** (`@githubnext/projections-host`) mounts the sandboxed
  renderer frames and manages all viewer state—progress, selection, comparison
  modes, settings, and renderer controls. You render the chrome yourself, so you
  choose exactly which controls to expose.
- **Default UI** (`@githubnext/projections-host/ui`) gives you a ready-made
  viewer built on the core with shadcn/ui. Its styles are scoped so it won't
  interfere with your page's CSS, and your page won't interfere with it.
- **VS Code UI** (`@githubnext/projections-host-vscode`) provides the same
  viewer using VS Code's native controls (VSCode Elements and codicons), wired
  to VS Code's `--vscode-*` variables so it matches the active webview theme.

Here is a minimal host built on the core alone that shows a side-by-side
comparison with search and no playback controls:

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

For the full API reference, see the [host guide](host.md).

## Building commenting on projections

Projections doesn't store comments itself, but it gives your app everything
needed to anchor discussions to a projection—for example, during pull request
review. The same hooks also work for any other per-item data, such as lint
findings.

Every comment attaches to a _target_: an entity or relationship from a single
extraction, identified by its own ID and optionally one of its properties.

```ts
type ProjectionTarget = {
  kind: 'entity' | 'relationship'
  id: string                 // the item's ID in the extraction
  side: 'before' | 'after'   // which extraction of a comparison; 'after' for a single extraction
  path?: string              // a property: an RFC 6901 pointer into the item's data, such as '/owner'
}
```

Just like the left and right sides of a code diff, an item that was removed can
only be commented on `before`. Targets deliberately avoid change IDs and
presented rows, because those depend on the comparator and whichever pair of
revisions you're viewing. Alongside each comment, store the projection ID, the
revision, the target, and `targetDigest(engine, extraction, target)`. If a later
revision produces a different digest—or none at all—you know the comment is
outdated.

Selection works in both directions. When someone clicks an item, the host
reports `selection {rowId, targets, target?}`: every underlying item that row
represents (a renamed, split, or merged row represents more than one), plus the
specific property if they clicked one. Going the other way, calling
`selectTarget(target)` highlights that item across every pane and view, or lets
you know it isn't there by returning `{status: 'absent', reason}`.

To mark items that already have comments, pass `annotations`—each with a target
and an optional `count`, `label`, and `tone`. Renderers and built-in views draw
a badge on each matching item, and activating a badge selects the item and fires
`onAnnotationActivate`. Any annotations whose targets aren't present in the
current view are returned in `unplacedAnnotations`.

When you want to float a popover or comment thread next to what's selected,
`useProjectionAnchor(projection)` tracks the selected item's bounding box in
page coordinates as the user scrolls, resizes, or switches modes. For shareable
URLs, `encodeTarget(target)` and `decodeTarget(text)` convert targets to and
from URL-safe strings.

Putting those pieces together on the headless core looks like this:

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

Both the default UI and the VS Code UI accept the same `annotations`,
`onAnnotationActivate`, and `onSelectionChange` props. Selecting an item opens a
detail card anchored over the stage showing what changed field by field (with
each changed property selectable), where it appears in the code, and what it
connects to. You can append your own UI to the bottom of that card with
`renderDetails`, and point its source links wherever you like—such as a pull
request diff—using `evidenceLink(location, side)`. If you'd rather draw the
selection details yourself, pass `details="none"`.
