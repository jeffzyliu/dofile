// The bars over an open .csv, .tsv or .log in the editor (docs/design/SPEC.md, section 3.11). Draws nothing for other
// files (a .dta tab's bars are output/DtaView.tsx's).
import { useEffect, useState } from "preact/hooks";
import { fileCommand } from "../../stata/quote.ts";
import { runCommand } from "../run.ts";
import { activeTab, files, fresh, tabs } from "../state.ts";
import { store } from "../store.ts";
import { CommandBar } from "../ui/CommandBar";
import { Icon } from "../ui/Icon";
import { downloadEntry } from "./actions.ts";
import { decodeText } from "./open.ts";
import { baseName, extOf, rowCount } from "./tree.ts";

const TABLE = new Set([".csv", ".tsv"]);

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
  const made = fileCommand("import delimited", path);
  return (
    <>
      <div class="filebar">
        <Icon name="file" />
        <span class="what">
          <b>{path}</b>
          {rows && ` · ${rows}`}
        </span>
      </div>
      <CommandBar
        made={made}
        row="filebar"
        code="command"
        button="btn"
        verb="Import"
        copyLabel="Copy the import command"
        what={`import ${baseName(path)}`}
        run={runCommand}
      />
    </>
  );
}
