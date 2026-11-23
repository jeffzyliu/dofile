// Pure helpers on the page's file paths (no state, no DOM): what the state modules and the files/ code share.

/** Whether `path` is `top` or lies under it. */
export const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`);
/** `path` after `from` was renamed to `to` (a path not under `from` stays). */
export const movedPath = (path: string, from: string, to: string) =>
  within(path, from) ? to + path.slice(from.length) : path;
