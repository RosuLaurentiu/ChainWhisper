export type StateUpdate<T> = T | ((previous: T) => T);

export const resolveStateUpdate = <T,>(next: StateUpdate<T>, previous: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
