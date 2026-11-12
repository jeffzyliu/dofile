// Key rules shared by the page's own controls (ui/). Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).

/** Whether a keydown is a repeat of a held Enter (with or without Ctrl, Cmd, Shift or Alt). A dialog lets no such event
 *  press one of its buttons (ui/Dialog.tsx): the key that opened the dialog must not also answer it. Ctrl/Cmd+Enter with
 *  no engine opens the download prompt, whose "Download" has the focus by the time the key repeats. */
export const isHeldEnter = (e: { key: string; repeat: boolean }): boolean => e.repeat && e.key === "Enter";
