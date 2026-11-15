/** `3 files`, `1 commit`: a count and its noun, for the nouns these labels use, whose plural adds `s`. */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
