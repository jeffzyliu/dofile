# Code style (web/)

How the web demo's TypeScript is written. `web/CLAUDE.md` holds the architecture rules and the commands; this file holds
the rest. Read it before writing or reviewing code in `web/`. A rule that a check enforces says which check.

## Comments

**Comments are sparse; the code says the rest.** A file header is 1-3 lines on the file's role, only when the name
does not say it: no inventory of files, callers or signals. JSDoc on a function or type only for what its name and
types leave out (units, what null means, an ordering, why); where it explains parameters or the result, TSDoc tags
read better than prose: `@param name - ...`, `@returns ...` (no `{type}`: the signature has it; for a destructured
options parameter, whose fields `@param` cannot name, explain them in prose). A JSDoc sits directly above the
declaration it documents. Inline comments only for a non-obvious why (a browser quirk, a race, a workaround) or a unit
or meaning on a field (`// ms`). Each fact lives in one place (a type first, then a test name, `web/CLAUDE.md`, a doc):
point to it ("the plain logic: tree.ts"), never restate it or describe what another file does. No history or
provenance (steps, issue IDs, dates, review rounds: git has them) and no links into `docs/archive/`. Keep hard-won
knowledge (browser quirks, measured numbers, why a simpler way failed) on the line that handles it, shortened.

## Functions

- **A function with an explicit `Promise<...>` return type is `async`** (Grit rule in `biome/architecture.grit`;
  syntactic, so an inferred type is not seen). Where it must not be (a cached promise, a promise-like object, a
  deliberate synchronous throw): `// biome-ignore lint/plugin: <reason>`.
- **In an object literal, a named function is a method** (`async handle(args) { ... }`), not an arrow property
  (`handle: async (args) => ...`), unless it needs the enclosing `this`. Not checked by a rule; older files still have arrow
  properties: convert a file's when you change it.
