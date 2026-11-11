// Stata highlighting for CodeMirror 6, a line tokenizer (StreamLanguage). Commands come from the engine's own registry
// (commands.json, `npm run commands`), so a highlighted command is one dofile runs; abbreviations follow the
// registry's minimum length (`reg`, `gen`). Handles: `*` comments at line start, `//` and `///`, nested `/* */`,
// strings and compound quotes, local macros (nested), globals, numbers, and the command word after prefixes and `:`.
import { StreamLanguage, type StringStream } from "@codemirror/language";
import data from "./commands.json";

const COMMANDS: Record<string, number> = data.commands;
// prefixes the interpreter itself handles (not in the registry), with their shortest forms
const PREFIXES: Record<string, number> = {
  quietly: 3,
  noisily: 3,
  capture: 3,
  by: 2,
  bysort: 3,
  version: 4,
  ...Object.fromEntries(data.prefixes.map((p) => [p, p.length])),
};
const KEYWORDS = new Set([
  "if",
  "in",
  "using",
  "else",
  "foreach",
  "forvalues",
  "while",
  "of",
  "local",
  "global",
  "scalar",
  "matrix",
  "program",
  "end",
  "continue",
  "exit",
  "varlist",
  "newlist",
  "numlist",
]);

const SORTED = Object.keys(COMMANDS).sort();
export function isCommand(word: string): boolean {
  if (word in COMMANDS) return true;
  // an abbreviation: some command starts with it and allows this short a form
  let lo = 0,
    hi = SORTED.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    SORTED[mid] < word ? (lo = mid + 1) : (hi = mid);
  }
  for (let i = lo; i < SORTED.length && SORTED[i].startsWith(word); i++)
    if (word.length >= COMMANDS[SORTED[i]]) return true;
  return false;
}
const isPrefix = (w: string) => Object.entries(PREFIXES).some(([p, n]) => p.startsWith(w) && w.length >= n);

interface State {
  comment: number;
  quote: number;
  atCommand: boolean;
}

function macro(stream: StringStream): void {
  let depth = 1; // after the opening backquote; nested `a`b'' closes at depth 0
  while (depth > 0 && !stream.eol()) {
    const c = stream.next();
    if (c === "`") depth++;
    else if (c === "'") depth--;
  }
}

export const stata = StreamLanguage.define<State>({
  name: "stata",
  startState: () => ({ comment: 0, quote: 0, atCommand: true }),
  token(stream, state) {
    if (stream.sol() && !state.comment) state.atCommand = true;
    if (state.comment) {
      // inside /* */, which nests
      while (!stream.eol()) {
        if (stream.match("/*")) state.comment++;
        else if (stream.match("*/")) {
          if (--state.comment === 0) break;
        } else stream.next();
      }
      return "comment";
    }
    if (state.quote) {
      // inside `"..."', which nests
      while (!stream.eol()) {
        if (stream.match('`"')) state.quote++;
        else if (stream.match("\"'")) {
          if (--state.quote === 0) break;
        } else stream.next();
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (state.atCommand && stream.match(/^\*.*/)) return "comment"; // * comments only where a command could start
    if (stream.match("/*")) {
      state.comment = 1;
      return "comment";
    }
    if (stream.match(/^\/\/.*/)) return "comment"; // also /// (continuation)
    if (stream.match('`"')) {
      state.quote = 1;
      return this.token!(stream, state);
    }
    if (stream.eat("`")) {
      macro(stream);
      return "variableName.special";
    }
    if (stream.match(/^\$\{[^}]*\}?/) || stream.match(/^\$\w+/)) return "variableName.special";
    if (stream.eat('"')) {
      while (!stream.eol() && stream.next() !== '"');
      return "string";
    }
    if (stream.match(/^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i)) {
      state.atCommand = false;
      return "number";
    }
    const word = stream.match(/^[A-Za-z_][\w.]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (state.atCommand) {
        if (isPrefix(w)) return "keyword"; // quietly, capture, by ...: a command can still follow
        state.atCommand = false;
        if (isCommand(w)) return "keyword";
        return KEYWORDS.has(w) ? "keyword" : null;
      }
      return KEYWORDS.has(w) ? "keyword" : null;
    }
    const c = stream.next();
    if (c === ":" || c === "{") state.atCommand = true; // by x: cmd, quietly: cmd, { cmd
    return c && "=<>!&|+-*/^".includes(c) ? "operator" : null;
  },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
});
