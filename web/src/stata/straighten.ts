// Straight quotes for typed text. A phone's "Smart Punctuation" turns a typed ' or " into a curly quote (U+2018, U+2019,
// U+201C, U+201D) and two hyphens into an em dash (U+2014), and Stata-syntax code has no use for them: a local macro is
// closed by a straight apostrophe and a string by straight double quotes. These functions map such characters back to what
// was typed. They are for TYPED text only (the command line's input handling and the editor's input handler call them for
// `insertText` and `insertReplacementText`); a paste, a drop and text already there stay as they are. Pure: no DOM.

/** The characters Smart Punctuation makes, and the text they stand for. The en dash (U+2013) is left alone. */
const STRAIGHT: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "—": "--",
};
const SMART = /[‘’“”—]/g;

/** `text` with each smart-punctuation character replaced by what was typed for it. */
export const straighten = (text: string): string => text.replace(SMART, (c) => STRAIGHT[c]);

/** True for the `inputType` of an `input` or `beforeinput` event that is typing, or text the keyboard puts in place of
 *  typed text (autocorrect, a suggestion): not a paste (`insertFromPaste`), a drop (`insertFromDrop`), an undo or a
 *  composition. */
export const isTypedInput = (inputType: string): boolean =>
  inputType === "insertText" || inputType === "insertReplacementText";

/**
 * After a field took typed text `data` and the caret is at `caret`: the value and caret with that text straightened,
 * or null when there is nothing to change. Only the text just inserted (the `data.length` characters before the caret)
 * is touched; if the value does not hold `data` there (the browser did something else), nothing is.
 */
export function straightenInserted(
  value: string,
  caret: number,
  data: string,
): { value: string; caret: number } | null {
  const fixed = straighten(data);
  if (fixed === data || value.slice(caret - data.length, caret) !== data) return null;
  return {
    value: value.slice(0, caret - data.length) + fixed + value.slice(caret),
    caret: caret - data.length + fixed.length,
  };
}
