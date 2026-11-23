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

/** Which arrow keys a roving widget answers to: Left and Right, Up and Down, or all four. */
export type RoveAxis = "x" | "y" | "both";

/** The place a roving widget's key moves to, or null for a key it leaves alone: any key with Alt, Ctrl or Cmd (Alt+Left
 *  is Back; Shift stays), a key off the `axis`, and a widget with no place (`count` 0). Home and End go to the ends; at
 *  an end an arrow wraps to the other end or, with `wrap` off, stays on it.
 *  @param at - the place now (-1 for none)
 *  @param count - how many places there are */
export function roveKey(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  at: number,
  count: number,
  { axis, wrap }: { axis: RoveAxis; wrap: boolean },
): number | null {
  if (e.altKey || e.ctrlKey || e.metaKey || count < 1) return null;
  const across = axis !== "y";
  const down = axis !== "x";
  let to: number;
  if (e.key === "Home") to = 0;
  else if (e.key === "End") to = count - 1;
  else if ((across && e.key === "ArrowRight") || (down && e.key === "ArrowDown")) to = at + 1;
  else if ((across && e.key === "ArrowLeft") || (down && e.key === "ArrowUp")) to = at - 1;
  else return null;
  return wrap ? ((to % count) + count) % count : Math.min(Math.max(to, 0), count - 1);
}
