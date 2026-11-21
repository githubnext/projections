/** The active option of `count`: `index`, or the last that remains once options go away (pinning, as the page narrows). */
export const activeOption = (index: number, count: number) => (count ? Math.min(index, count - 1) : 0)

/** The option `by` steps from `index` among `count`, wrapping around. */
export const stepOption = (index: number, by: number, count: number) => (count ? (index + by + count) % count : 0)
