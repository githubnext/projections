import {pluralWord} from '@githubnext/projections-renderer-sdk/presentation'

/** `3 scenarios`, `1 check`: a count and its noun, in the noun's English plural when it isn't one. */
export const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : pluralWord(noun)}`
