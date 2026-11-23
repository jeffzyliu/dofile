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

## Naming

- **A name states nothing false.** Text is not a path, `next` is not the last, `At` is a time or a position, `MB`
  is not MiB.
- **One word per concept, one concept per word, per module.** The glossary below fixes the domain words.
- **Length follows lifetime.** A `const` in a callback or a function under about ten lines may be short. A `let`,
  module state, or anything live across a loop or an `await` says what it holds.
- **The kind is in the name:** `...Count`, plurals, `...Paths`, `xByKey`, and the unit (`Ms`, `S`, `Px`,
  `Bytes`, `Mib`). A 1-based position is a `number`, not an `index`.
- **Booleans:** a bare adjective is fine when the owner supplies the subject or it mirrors a DOM attribute
  (`disabled`, `open`). Otherwise `is`, `has`, `can`, `will` or a participle with its context. Never
  negated, never a bare noun or verb.
- **Functions:** an action is a verb; a pure derivation may be a noun; a notification is past tense (`ended`); a
  predicate is `is`, `has` or `can`. A participle never names something that returns a non-boolean or has effects.
- **Two index spaces get two names.** `at` is only ever an index.
- **A field and the local that feeds it share a name.** A wire name from Python stays and is translated once.
- **Short names are a closed list:** `e`, `el`, `io`, `rc`, `py`, `st`, `m`, `vv`, and the tags `s`,
  `d`, `b`, `t`, `do`. `t0` only where the module has one clock.
- **No type name shadows a DOM global** (`Event`, `Request`, `Storage`).
- **A name that needs five words** is a sign to extract.

Leave alone: booleans that mirror the DOM or have an owner (`disabled`, `open`, `tab.dirty`, `isPhone`); the
discriminant tags `s`, `d`, `b`, `t`, `do` (SPEC, tests, the e2e hook); wire names from Python
(`fresh_locals`, `e_changed`); geometry and math locals; noun-named pure functions (`parentOf`, `baseName`).

Before a rename, grep `biome/architecture.grit` and `test/imports.test.ts`: they match identifiers by name.
Renames happen inside the restructure that owns the file, and never in the same commit as a spacing change.

### Glossary

One word per concept. Wire names (the worker protocol, `start-files.json`, the test hook, state tags, SPEC) keep their
spelling; code translates them once. `URL` is spelt in capitals inside a name (`indexURL`, `heapURL`, `snapshotURL`).

| Concept | Words | Not |
|---|---|---|
| A request number from the machine | `ticket` (type `Ticket`), on states, events, effects and client calls | `id`, `download`, `worker`, `take`, `n` |
| Decompression | `unpack` for the verb; `decoder` for which one | `inflate`, `decompress`, `decode` (that is text), `how` |
| The build | `built` (the build number) and `buildId` (its string) together; `Build` is the part of the start files that `mount` needs | `version` |
| The Python module | `browser` (`dofile.browser`), type `Browser`; the web browser is never a variable | `engine` |
| The start files | `StartFiles`, `startFiles`, `start-files.json`; "list" only as a local alias. The state tags (`starting-list`, `list-*`) are tags, not names | `List` |
| An open file in the editor | `EditorTab` (the type); `tab`, `tabs`, `activeTab` only in editor and files code and the test hook; `editorTab` anywhere else | `OpenTab`, bare `tab` outside those |
| A tab of the Output pane | `outputTab` | |
| The phone's bottom bar | `phoneView` (SPEC's "Views tablist") | `phoneTab` |
| A browser tab | `browserTab`; `otherTab`, `OTHER_TAB` and `other-tab-*` mean another browser tab (wire names, kept). The words the visitor reads stay "another tab", "this tab" | `page`, bare `tab` |
| The Web Lock `dofile-engine` | `engineLock` (`engine/lock.ts`) | `tabLock`, `engine/tab.ts` |
| A run | `run` is the record (type `RunHead`); `runId` its number; `runHandlers` the controller's handlers; a count says what it counts (`engineRuns`, `runsInFlight`). "Run" the verb is the wire's op and the visitor's word | `runs` for a count or the handlers |
| The snapshot | `snapshot` alone only as the wire or data key; `snapshotStart` (a snapshot start, boolean), `snapshotURL` (its folder), `heap` (the heap file or its bytes), `snapshotFiles` (the group) | `snapshot` for any of these, `snapshotBase`, `fromSnapshot` |

The DOM's own words stay: `role="tab"`, `.tabbar`.

## Spacing

**A function body over about twelve lines is written in paragraphs: a blank line between steps, and above a comment
that opens one.** The line width stays 120.

- A blank line above a full-line comment inside a body, unless it is the first line of its block.
- A blank line after the opening run of guard clauses.
- A blank line before and after a multi-line local function, and after a multi-line `if`, `for` or `try` block.
  No blank line before a lone closing `return` or `continue`.
- A trailing comment that pushes its line past about 100 columns moves to its own line above.
- Braces on a conditional that has an `else` or spans more than one line; one-line guards stay.
- In tests, a blank line between set-up, action and assertions.
- One declaration per statement, then related declarations grouped by blank lines. Biome's `useSingleVarDeclarator`
  checks this.

No other rule checks spacing, and the formatter keeps a blank line but never adds one: a reader finds the breaks that
have no comment and no block edge.
