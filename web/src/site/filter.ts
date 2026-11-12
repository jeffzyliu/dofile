// The commands page's filter (plain TypeScript, tested in Node): the names that contain what was typed, in the list's own
// order. Case is ignored, and so are spaces around the text. Nothing typed: every name.
export function filterNames(names: string[], typed: string): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return names;
  return names.filter((n) => n.toLowerCase().includes(q));
}
