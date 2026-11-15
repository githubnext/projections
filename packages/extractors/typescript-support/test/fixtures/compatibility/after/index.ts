export interface JobOptions {
  attempts?: number
  delay?: number
  priority: 'low' | 'normal' | 'high' | 'critical'
  timeout?: number
}

export interface Job<T> {
  id: string
  data: T
  attempts: number
  createdAt: Date
}

export type Status = 'waiting' | 'active' | 'done' | 'failed'

export interface QueueOptions {
  concurrency: number
}

export class Queue<T> {
  readonly name: string
  private jobs = new Map<string, Job<T>>()

  constructor(name: string, readonly options: QueueOptions = {concurrency: 1}) {
    this.name = name
  }

  add(data: T, options?: JobOptions, signal?: {readonly aborted: boolean}): Job<T> {
    const job = {id: String(this.jobs.size + 1), data, attempts: options?.attempts ?? 1, createdAt: new Date()}
    if (!signal?.aborted) this.jobs.set(job.id, job)
    return job
  }

  get(id: string): Job<T> {
    const job = this.jobs.get(id)
    if (!job) throw new Error(`No job ${id}`)
    return job
  }

  pause(): void {}

  async drain(): Promise<void> {}
}

export function createQueue<T>(name: string, options: QueueOptions): Queue<T> {
  return new Queue<T>(name, options)
}

export function retry(job: Job<unknown>, attempts: number): void {
  job.attempts = attempts
}

export function isJob(value: unknown): value is Job<unknown> {
  return typeof value === 'object' && value !== null && 'id' in value
}

export const VERSION: string = '2.0.0'
