// The visitor's choices kept across visits, in localStorage. No signal: the owners (state/layout.ts, theme.ts, sample.ts)
// read and write it.

// localStorage, which a browser may refuse (some private modes) and Node does not have
export const saved = {
  get: (key: string) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* not kept: the page works the same this visit */
    }
  },
};
