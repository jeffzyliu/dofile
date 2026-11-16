// A command that reads a file, built from the file's path. Plain TypeScript, tested in Node (test/files-ui.test.ts).

/** Control characters, which a file name may hold on some systems (a line break, a tab). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is this pattern's purpose
export const CONTROL = /[\u0000-\u001f\u007f]/;

/** `verb "path", clear`, or `{ problem }` when the path cannot be put in a command. The engine expands macros in the
 *  text it runs, so the path is quoted: `$` is written `\$` (the engine keeps a `$` after a backslash: the ODT-8 patch),
 *  and a double quote puts the path in compound quotes (`"…"'). No command for a backquote (a local macro, which a
 *  backslash does not escape), a control character (a line break would start another command) or `"'` (it would end
 *  the compound quotes). */
export function fileCommand(verb: "use" | "import delimited", path: string): { command: string } | { problem: string } {
  if (path.includes("`") || CONTROL.test(path) || path.includes(`"'`))
    return { problem: "Its name has a character a command can't use: rename the file." };
  const text = path.replace(/\$/g, () => "\\$");
  return { command: `${verb} ${path.includes('"') ? `\`"${text}"'` : `"${text}"`}, clear` };
}
