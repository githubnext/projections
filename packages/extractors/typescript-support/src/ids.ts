/** Extractors implemented by this worker; every other built-in runs natively in the CLI. */
export const workerIds = ['typescript-public-api', 'nestjs-di'] as const
export type WorkerExtractorId = (typeof workerIds)[number]
