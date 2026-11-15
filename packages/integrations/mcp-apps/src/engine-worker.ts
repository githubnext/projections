// The engine's Worker as the view starts it: SHA-256 where the Worker has no `crypto.subtle` (digest.ts), then the
// engine's own Worker script.
import './install-digest.js'
import '@githubnext/projections-inspector/bundle/engine/worker-entry.js'
