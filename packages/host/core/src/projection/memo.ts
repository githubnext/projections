// Memoization without a framework that a render may abandon: a derived value keeps its identity while its inputs do, as
// React's memos keep it, so the store's snapshot changes only where something changed. Each memo compares first with
// the values last committed, then with the ones last computed; computing never replaces what was committed, so a render
// that is thrown away (React may render a state it never commits) costs the committed values nothing. `commit` keeps
// what the last computation used: React's adapter calls it after each committed render, a vanilla host after each read.

type Entry<A, R> = {readonly args: A; readonly result: R}

const sameArgs = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((arg, index) => Object.is(arg, b[index]))

/** A set of memos and state committed together. */
export interface Memos {
  /** `compute`, recomputed only when an argument differs (by `Object.is`) from the committed call's and the last one's. */
  memo<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R
  /**
   * A value compared by its JSON: a copy taken when it changes, kept while it doesn't, so a value the host changes in
   * place is still a change, and nothing it holds is shared. `undefined` stays `undefined`.
   */
  byValue<T>(): (value: T) => T
  /** A value carried from one computation to the next: `read` the committed one, `write` the next. */
  cell<T>(initial: T): {read(): T; write(value: T): void}
  /** Keeps what the last computation used, as what later ones compare with first. */
  commit(): void
}

export function createMemos(): Memos {
  const commits: (() => void)[] = []
  const memo = <A extends readonly unknown[], R>(compute: (...args: A) => R) => {
    let committed: Entry<A, R> | undefined
    let current: Entry<A, R> | undefined
    commits.push(() => {
      committed = current
    })
    return (...args: A): R => {
      if (committed && sameArgs(committed.args, args)) current = committed
      else if (!current || !sameArgs(current.args, args)) current = {args, result: compute(...args)}
      return current.result
    }
  }
  return {
    memo,
    byValue: <T>() => {
      const parsed = memo((key: string, missing: boolean) => (missing ? undefined : JSON.parse(key)) as T)
      return (value: T) => parsed(JSON.stringify(value ?? null), value === undefined)
    },
    cell: <T>(initial: T): {read(): T; write(value: T): void} => {
      let committed = initial
      let next = initial
      commits.push(() => {
        committed = next
      })
      return {
        read: () => committed,
        write: (value: T) => {
          next = value
        },
      }
    },
    commit: () => {
      for (const commit of commits) commit()
    },
  }
}

/** A selector over memos: call it to compute, `commit` once what it computed is shown. */
export type Selector<A extends readonly unknown[], R> = ((...args: A) => R) & {commit(): void}

/** A selector from `build`, given its memos. */
export function selector<A extends readonly unknown[], R>(build: (memos: Memos) => (...args: A) => R): Selector<A, R> {
  const memos = createMemos()
  return Object.assign(build(memos), {commit: memos.commit})
}
