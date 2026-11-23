# Code style (web/)

How the web demo's TypeScript is written; `web/CLAUDE.md` holds the architecture rules and the commands. Read this
before writing or reviewing code in `web/`. A rule that a check enforces names the check.

## Comments

**Comments are sparse; the code says the rest.**

- **File header:** 1-3 lines on the file's role, only when the name does not say it. No inventory of files, callers or
  signals.
- **JSDoc:** only what the name and types leave out (units, what null means, an ordering, why), directly above its
  declaration. For parameters and the result use TSDoc tags (`@param name - ...`, `@returns ...`) without `{type}`;
  explain a destructured options parameter's fields in prose.
- **Inline:** only a non-obvious why (a browser quirk, a race, a workaround) or a field's unit or meaning (`// ms`).
- **One place per fact** (a type first, then a test name, `web/CLAUDE.md`, a doc): point to it ("the plain logic:
  tree.ts"); never restate it or describe another file.
- **No history or provenance** (steps, issue IDs, dates, review rounds: git has them) and no links into
  `docs/archive/`.
- **Hard-won knowledge** (browser quirks, measured numbers, why a simpler way failed) stays on the line that handles
  it, shortened.

## Functions

- **A function with an explicit `Promise<...>` return type is `async`** (Grit rule in `biome/architecture.grit`;
  syntactic, so it does not see an inferred type). An exception (a cached promise, a promise-like object, a deliberate
  synchronous throw) takes `// biome-ignore lint/plugin: <reason>`.
- **In an object literal, a named function is a method** (`async handle(args) { ... }`), not an arrow property
  (`handle: async (args) => ...`), unless it needs the enclosing `this`. No rule checks it; convert an older file's
  arrow properties when you change the file.
