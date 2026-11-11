// A command that reads a file, built from the file's path: the .dta tab's `use "data/wages.dta", clear` (output/DtaView.tsx)
// and the .csv bar's `import delimited "data/raw/survey.csv", clear` (files/FileBar.tsx). The engine expands macros in
// the text it runs, so a path is not put in as it is:
//  - `$` is written `\$` (the engine keeps a `$` after a backslash: the ODT-8 patch), or `$x` in a name would be a global;
//  - a double quote puts the path in compound quotes (`"…"');
//  - a path the command cannot hold safely gives no command but a reason: a backquote (a local macro, which a backslash
//    does not escape), a control character (a line break would end the command and start another), or `"'` (it would
//    end the compound quotes).
// Plain TypeScript, tested in Node (test/files-ui.test.ts).

/** Control characters, which a file name may hold on some systems (a line break, a tab). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is this pattern's purpose
export const CONTROL = /[\u0000-\u001f\u007f]/;

/** `verb "path", clear`, or `{ problem }` when the path cannot be put in a command (see above). */
export function fileCommand(verb: "use" | "import delimited", path: string): { command: string } | { problem: string } {
  if (path.includes("`") || CONTROL.test(path) || path.includes(`"'`))
    return { problem: "Its name has a character a command can't hold: rename the file to use it here." };
  const text = path.replace(/\$/g, () => "\\$");
  return { command: `${verb} ${path.includes('"') ? `\`"${text}"'` : `"${text}"`}, clear` };
}
