// Key rules shared by the page's own controls (ui/). Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).

/** Whether a keydown is a repeat of a held Enter (with or without Ctrl, Cmd, Shift or Alt). A dialog lets no such event
 *  press one of its buttons (ui/Dialog.tsx): the key that opened the dialog must not also answer it. Ctrl/Cmd+Enter with
 *  no engine opens the download prompt, whose "Download" has the focus by the time the key repeats. */
export const isHeldEnter = (e: { key: string; repeat: boolean }): boolean => e.repeat && e.key === "Enter";

/** The `onKeyDown` of a Run button (the toolbar's, the phone's, the command line's): a held Enter on it presses it once.
 *  Preact keeps one `<button>` node while the label goes "Start engine", "Starting…", "Run", and an off button keeps the
 *  focus (aria-disabled, never `disabled`), so every repeat would be one more click, the first one after the engine is
 *  ready a run nobody asked for. Cancelling the repeated keydown cancels the click that goes with it. */
export const ignoreHeldEnter = (e: { key: string; repeat: boolean; preventDefault(): void }): void => {
  if (isHeldEnter(e)) e.preventDefault();
};
