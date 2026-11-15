// The comparator runtime's Worker as the view starts it: SHA-256 where the Worker has no `crypto.subtle` (digest.ts),
// then the runtime's own Worker script.
import './install-digest.js'
import '@githubnext/projections-inspector/bundle/comparator/worker-entry.js'
