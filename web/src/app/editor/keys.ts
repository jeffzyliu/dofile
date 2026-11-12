// Which key press is Save (Editor.tsx's window listener): Ctrl or Cmd with S, on every platform, without Alt (AltGr on
// Windows sends Ctrl+Alt, and AltGr+S types a letter on some layouts) or Shift. S is the key that types "s" (Dvorak's
// too, wherever it sits), or, when the key types no Latin letter (a Cyrillic, Greek, Hebrew or Arabic layout: "ы"), the
// key in S's place (`code` "KeyS"), as CodeMirror's keymap does. Run's Ctrl/Cmd+Enter needs no such rule: Enter's `key`
// is "Enter" on every layout. Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).

export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export function isSaveKey(e: KeyPress): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  const k = e.key.toLowerCase();
  return k === "s" || (!/^[a-z]$/.test(k) && e.code === "KeyS");
}
