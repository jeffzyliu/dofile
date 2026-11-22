// The order of the page's file changes (docs/design/workspace.md, section 3): one chain of turns. Plain TypeScript, no
// state but the chain, so the editor's documents (editor/documents.ts) and the file actions can both take turns.

let turns: Promise<unknown> = Promise.resolve(); // the changes that tabs follow, one after the other

/** Run `fn` once the changes started before it have ended (a rejection ends one too). Resolves or rejects as `fn`.
 *  A rename or a delete keeps its turn until the tabs have followed it, so a Save pressed meanwhile writes under the
 *  tab's path as it is then (renamed, or closed: no write). A Save's turn only issues its write: the store applies
 *  changes in call order (engine/store.ts `change`), so a later rename moves the bytes it wrote. */
export function fileTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = turns.then(fn);
  turns = run.catch(() => {});
  return run;
}
