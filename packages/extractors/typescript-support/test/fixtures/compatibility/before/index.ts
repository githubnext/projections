export interface JobOptions {
  attempts?: number
  delay: number
  priority: 'low' | 'normal' | 'high'
}

export interface Job<T> {
  id: string
  data: T
  attempts: number
}

export type Status = 'waiting' | 'active' | 'done'

export class Queue<T> {
  readonly name: string
  private jobs = new Map<string, Job<T>>()

  constructor(name: string) {
    this.name = name
  }

  add(data: T, options?: JobOptions): Job<T> {
    const job = {id: String(this.jobs.size + 1), data, attempts: options?.attempts ?? 1}
    this.jobs.set(job.id, job)
    return job
  }

  get(id: string): Job<T> | undefined {
    return this.jobs.get(id)
  }

  remove(id: string): boolean {
    return this.jobs.delete(id)
  }

  pause(): void {}
}

export function createQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name)
}

export function retry(job: Job<unknown>, attempts: number | string): void {
  job.attempts = Number(attempts)
}

export const VERSION: string = '1.0.0'
