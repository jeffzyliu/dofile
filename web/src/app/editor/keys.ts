// Ctrl or Cmd on every platform. Enter's `key` is "Enter" on every layout, so Run needs no layout rule; Save does
// (isSaveKey).

export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Which key press is Save: Ctrl or Cmd with S, without Alt (AltGr on Windows sends Ctrl+Alt, and AltGr+S types a
 *  letter on some layouts) or Shift. S is the key that types "s" (Dvorak's too), or, on a layout with no Latin letter
 *  (Cyrillic, Greek, Hebrew, Arabic), the key in S's place (`code` "KeyS"), as CodeMirror's keymap does. */
export function isSaveKey(e: KeyPress): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  const k = e.key.toLowerCase();
  return k === "s" || (!/^[a-z]$/.test(k) && e.code === "KeyS");
}

/** Which key press is Run: Ctrl or Cmd with Enter, without Alt or Shift. */
export function isRunKey(e: KeyPress): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "Enter";
}
