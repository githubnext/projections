/** The color mode a story renders in, from the Storybook toolbar's theme. */
export type Theme = 'light' | 'dark'

/** The toolbar's theme (`globals.theme`, declared in `.storybook/preview.tsx`). */
export const themeOf = (globals: Record<string, unknown>): Theme => (globals.theme === 'dark' ? 'dark' : 'light')
