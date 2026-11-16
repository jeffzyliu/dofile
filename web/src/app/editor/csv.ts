// The column colors of a .csv or .tsv in the editor (SPEC 3.11): a tokenizer that splits a line at the separators
// outside double quotes. One line at a time, so a quoted field that holds a line break colors its second line as a new row.

/** Columns take the five colors (app.css .csv-c0 to .csv-c4) in turn. */
export const CSV_COLORS = 5;

/** The fields of one line: [from, to) offsets in the line, and the column (0-based). Separators lie between them. */
export function csvFields(line: string, sep: "," | "\t"): { from: number; to: number; col: number }[] {
  const out: { from: number; to: number; col: number }[] = [];
  let from = 0,
    quoted = false;
  for (let i = 0; i <= line.length; i++) {
    const c = line[i];
    if (c === '"')
      quoted = !quoted; // "" inside quotes toggles twice: still inside
    else if (i === line.length || (c === sep && !quoted)) {
      out.push({ from, to: i, col: out.length });
      from = i + 1;
    }
  }
  return out;
}
