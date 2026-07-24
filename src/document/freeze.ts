// Deep-freeze the in-memory document so any stray direct mutation throws (schema §0 invariant 1).
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj as object)) {
      deepFreeze((obj as any)[key]);
    }
  }
  return obj;
}
