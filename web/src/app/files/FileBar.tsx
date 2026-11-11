// The bars over an open .csv, .tsv or .log in the editor (docs/design/SPEC.md, section 3.11; P/.csv, P/.log). App.tsx
// places <FileBar /> above the editor in the Editor pane; it reads `tabs` and `activeTab` and draws nothing for other
// files (a .dta tab's bars are output/DtaView.tsx's).
//  - .csv, .tsv: bar 1 "data/raw/survey.csv · 1,204 rows" (the lines that are not empty, of the file as the store has
//    it, which is what Import reads); bar 2 `import delimited "data/raw/survey.csv", clear`, "Import" (run.ts
//    runCommand; disabled unless the engine is `ready`, `none` or `declined`, where a command runs or is queued), "Copy"
//    (aria-label "Copy the import command"; toast "Copied").
//  - .log: "output/analysis.log · written by the last run" (the second part when `fresh` has it), "Download" (the file
//    as the store has it).
// The column colors of a .csv and the .log tokenizer are the editor's (step 4b).
import { useEffect, useState } from "preact/hooks";
import { runCommand } from "../run.ts";
import { activeTab, engine, files, fresh, showToast, tabs } from "../state.ts";
import { store } from "../store.ts";
import { Icon } from "../ui/Icon";
import { downloadEntry } from "./actions.ts";
import { decodeText } from "./open.ts";
import { extOf, quoted, rowCount } from "./tree.ts";

const TABLE = new Set([".csv", ".tsv"]);
const CAN_RUN = new Set(["ready", "none", "declined"]); // a command runs now, or is queued while the prompt asks

/** The row count of a table file, read again when the store's copy changes (its size or time in `files`). */
function useRows(path: string | null) {
  const info = files.value.find((f) => f.path === path);
  const [rows, setRows] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    if (!path || !info) return;
    let live = true;
    store.read(path).then(
      (bytes) => {
        const text = decodeText(bytes);
        if (live) setRows(text === null ? null : rowCount(text));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [path, info?.size, info?.mtime]);
  return rows;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
  } catch (e) {
    console.warn(`[dofile] copy: ${(e as Error)?.message ?? e}`);
  }
}

export function FileBar() {
  const tab = tabs.value.find((t) => t.path === activeTab.value && t.kind === "text");
  const ext = tab ? extOf(tab.path) : "";
  const table = TABLE.has(ext);
  const rows = useRows(table && tab ? tab.path : null);
  if (!tab || !(table || ext === ".log")) return null;
  const path = tab.path;
  if (!table)
    return (
      <div class="filebar">
        <span class="what">
          <b>{path}</b>
          {fresh.value.has(path) && " · written by the last run"}
        </span>
        <span class="spacer" />
        <button
          type="button"
          class="head-link"
          onClick={() => {
            downloadEntry(path);
          }}
        >
          Download
        </button>
      </div>
    );
  const command = `import delimited ${quoted(path)}, clear`;
  return (
    <>
      <div class="filebar">
        <Icon name="file" />
        <span class="what">
          <b>{path}</b>
          {rows && ` · ${rows}`}
        </span>
      </div>
      <div class="filebar">
        <code class="command">{command}</code>
        <span class="spacer" />
        <button
          type="button"
          class="btn"
          disabled={!CAN_RUN.has(engine.value.s)}
          onClick={() => {
            runCommand(command);
          }}
        >
          Import
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Copy the import command"
          onClick={() => {
            copy(command);
          }}
        >
          Copy
        </button>
      </div>
    </>
  );
}
