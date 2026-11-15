// Shared plumbing for the TypeScript custom-extractor samples: read the extractor
// request, load the examined project's own TypeScript compiler, build its program
// and resolve configured API conventions through the checker. Each sample's
// extract.mjs adds only its domain logic.
//
// Copy this directory alongside a sample and list both in the projection
// definition's `extractor.sources`.
export {architecture} from './architecture.mjs'
export {compareIds, id, inputs, main, MAX_EVIDENCE, readRequest} from './basics.mjs'
export {enclosingName, handlerIdentity, initializer, literal, property, unwrap, visit} from './expressions.mjs'
export {loadTypeScript, project} from './project.mjs'
export {conventions, evidence, matcher, owner, resolve, symbolAt} from './symbols.mjs'
