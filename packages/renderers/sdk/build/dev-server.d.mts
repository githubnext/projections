export function recordDevServer(root: string, file: string, record: unknown): () => void
export function readText(path: string): string
export function resolveFile(root: string, file: string): {path: string; exists: boolean}
