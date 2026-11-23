// A .dta file's tab (docs/design/SPEC.md, section 3.11): two bars (the file's facts; the `use` command with Load and
// Copy) and the variables table. The table comes from call("describe_file", { path }): the file is read apart, so the
// data in memory, r() and the log stay untouched until Load. What was read stays in view.ts `dtaInfo`, since this view
// is unmounted when another tab is made active.

import { useEffect, useRef } from "preact/hooks";
import { fileCommand } from "../../stata/quote.ts";
import { formatSize } from "../bytes.ts";
import { baseName } from "../files/tree.ts";
import { runCommand } from "../run.ts";
import { engine } from "../state/engine.ts";
import { files } from "../state/files.ts";
import { showToast } from "../state.ts";
import { workerReachable } from "../states/predicates.ts";
import { CommandBar } from "../ui/CommandBar";
import { useFocusTarget } from "../ui/focus-hooks.ts";
import { Icon } from "../ui/Icon";
import { readDta } from "./dta.ts";
import { count } from "./format.ts";
import { VarTable } from "./VarTable";
import { dtaInfo } from "./view.ts";

const NOTE = " the data in memory is untouched until you press Load.";

export function DtaView({ path }: { path: string }) {
  const file = files.value.find((f) => f.path === path);
  const key = file ? `${file.size}:${file.mtime}` : "none";
  const up = workerReachable(engine.value);
  const root = useRef<HTMLDivElement>(null);
  useFocusTarget("dta-load", () => root.current?.querySelector<HTMLElement>("button:not([disabled])") ?? null);
  useEffect(() => {
    if (!up || dtaInfo.value[path]?.key === key) return;
    readDta(path, key);
  }, [path, key, up]);

  const info = dtaInfo.value[path]?.result;
  const summary = info && !("error" in info) ? info : null;
  const made = fileCommand("use", path);
  const name = baseName(path);
  const load = async (command: string) => {
    const run = runCommand(command);
    if (run.how !== "started") return; // it did not run: refused
    const r = await run.done;
    showToast(r.rc === 0 ? `Loaded ${name}` : `Couldn't load ${name}: r(${r.rc})`, r.rc === 0 ? undefined : "error");
  };
  return (
    <div class="dta-view" ref={root}>
      <div class="bar">
        <Icon name="file" />
        <b>{path}</b>
        {summary && ` · ${count(summary.nobs)} obs · ${count(summary.nvars)} vars`}
        {file && ` · ${formatSize(file.size)}`}
      </div>
      <CommandBar
        made={made}
        row="bar"
        code="cmd"
        button="btn primary"
        verb="Load"
        copyLabel="Copy the use command"
        what={`load ${name}`}
        run={load}
      />
      {info && "error" in info && <p class="note">Couldn't read this file: {info.error}</p>}
      {summary && (
        <div class="dta-body">
          <VarTable variables={summary.variables} />
          <p class="note">
            Read with <code>describe using</code>;{NOTE}
          </p>
        </div>
      )}
    </div>
  );
}
