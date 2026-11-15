// Adapted from shadcn/ui (https://ui.shadcn.com), MIT License, Copyright (c) 2023 shadcn. See ../components/LICENSE.shadcn.txt.
// Local change: tailwind-merge knows the `pj:` prefix.
import {clsx, type ClassValue} from 'clsx'
import {extendTailwindMerge} from 'tailwind-merge'

const twMerge = extendTailwindMerge({prefix: 'pj'})

/** Joins class names and resolves conflicting `pj:` Tailwind utilities, the last one winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
