// The commands page's filter (plain TypeScript, tested in Node): the names that contain what was typed, in the list's own
// order. Case is ignored, and so are spaces around the text. Nothing typed: every name.
export function filterNames(names: string[], typed: string): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return names;
  return names.filter((n) => n.toLowerCase().includes(q));
}

/** The count beside the field (a live region): "12 of 515 commands", with the prefixes shown when there are any
 *  ("0 of 515 commands, 1 prefix"); nothing when nothing is typed. */
export function countText(typed: string, commands: number, total: number, prefixes: number): string {
  if (!typed.trim()) return "";
  const p = prefixes ? `, ${prefixes} ${prefixes === 1 ? "prefix" : "prefixes"}` : "";
  return `${commands} of ${total} commands${p}`;
}
