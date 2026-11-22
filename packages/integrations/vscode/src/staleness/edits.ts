import type {ResultStamp} from '../staleness.ts'

export const workingTree = 'working-tree'
export const symbolic = (ref: string) => ref !== workingTree && !/^[0-9a-f]{40}$/iu.test(ref)
/** Whether the result applied the working tree's definition (`identity.definitionDigest` is the working tree's). */
const usesEdits = (stamp: ResultStamp) => stamp.definition === undefined || stamp.definition === workingTree
/** Whether the definition's edits bear on the result: it applied them, or its tab applies them now. */
export const readsEdits = (stamp: ResultStamp, applies: string | undefined) => usesEdits(stamp) || applies === workingTree
