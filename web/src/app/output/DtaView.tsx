// A .dta file's tab (docs/design/SPEC.md, section 3.11; P/.dta): not an editor. App.tsx shows <DtaView path> in the
// editor's place while the active tab is { kind: "dta" } (4a's files/open.ts adds it); the editor stays mounted, hidden.
//  - Bar 1: "data/wages.dta · 500 obs · 3 vars · 8 KB". Bar 2: `use "data/wages.dta", clear`, "Load" (primary: it runs
//    the command as the command line does, run.ts runCommand; off unless the engine is ready or can be asked to
//    start: with no engine, `none` or `declined`, it opens the download prompt and loads nothing, as Run does) and "Copy" (the command goes to the clipboard, to paste into a do-file). The command comes from
//    stata/quote.ts fileCommand (`$` escaped); for a name a command cannot hold (a backquote, a line break, `"'`) bar 2
//    says why in place of the command, and Load and Copy are off. The size is the tree's (files/tree.ts formatSize).
//    When Load ends a toast says "Loaded wages.dta" or "Couldn't load wages.dta: r(601)" (the file's name, SPEC 8).
//  - The variables table comes from engine.ts call("describe_file", { path }) (OQ-5): the file is read apart, so the data
//    in memory, r() and the log are untouched until Load. It is asked again when the file changes (its size or time in
//    `files`) and when an engine becomes available; what was read stays in view.ts `dtaInfo`, since this view is
//    unmounted when another tab is made active. With no engine: the two bars and no table.

import { useEffect } from "preact/hooks";
import { fileCommand } from "../../stata/quote.ts";
import { call } from "../engine.ts";
import { baseName, formatSize } from "../files/tree.ts";
import { runCommand } from "../run.ts";
import { engine, files, showToast } from "../state.ts";
import { Icon } from "../ui/Icon";
import { copyText } from "./clip.ts";
import { count } from "./format.ts";
import { dtaInfo } from "./view.ts";

const NOTE = " the data in memory is untouched until you press Load.";
// engine states in which a worker is there, or on its way, to answer a read
const UP = new Set(["starting-worker", "ready", "running", "breaking", "waiting"]);
// engine states in which Load does something: runs the command (`ready`), or opens the download prompt (no engine)
const CAN_LOAD = new Set(["ready", "none", "declined"]);

export function DtaView({ path }: { path: string }) {
  const file = files.value.find((f) => f.path === path);
  const key = file ? `${file.size}:${file.mtime}` : "none";
  const up = UP.has(engine.value.s);
  useEffect(() => {
    if (!up || dtaInfo.value[path]?.key === key) return;
    call("describe_file", { path }).then(
      (result) => {
        dtaInfo.value = { ...dtaInfo.value, [path]: { key, result } };
      },
      () => {}, // no engine, or a reset cut it: asked again when one is up
    );
  }, [path, key, up]);

  const info = dtaInfo.value[path]?.result;
  const summary = info && !("error" in info) ? info : null;
  const made = fileCommand("use", path);
  const command = "command" in made ? made.command : null;
  const load = async () => {
    if (command === null) return;
    const run = runCommand(command);
    if (run.how !== "started") return; // it did not run: refused, or no engine (the download prompt opened)
    const r = await run.done;
    const name = baseName(path);
    showToast(r.rc === 0 ? `Loaded ${name}` : `Couldn't load ${name}: r(${r.rc})`, r.rc === 0 ? undefined : "error");
  };
  return (
    <div class="dta-view">
      <div class="bar">
        <Icon name="file" />
        <b>{path}</b>
        {summary && ` · ${count(summary.nobs)} obs · ${count(summary.nvars)} vars`}
        {file && ` · ${formatSize(file.size)}`}
      </div>
      <div class="bar">
        {command !== null ? (
          <code class="cmd">{command}</code>
        ) : (
          <span class="why">{"problem" in made && made.problem}</span>
        )}
        <span class="spacer" />
        <button
          type="button"
          class="btn primary"
          disabled={command === null || !CAN_LOAD.has(engine.value.s)}
          onClick={load}
        >
          Load
        </button>
        <button
          type="button"
          class="btn"
          aria-label="Copy the use command"
          disabled={command === null}
          onClick={() => command !== null && copyText(command)}
        >
          Copy
        </button>
      </div>
      {info && "error" in info && <p class="note">Couldn't read this file: {info.error}</p>}
      {summary && (
        <div class="dta-body">
          <div class="scroll-x">
            <table class="t">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Format</th>
                </tr>
              </thead>
              <tbody>
                {summary.variables.map((v) => (
                  <tr key={v.name}>
                    <td class="mono">{v.name}</td>
                    <td class={v.label ? undefined : "muted"}>{v.label || "no label"}</td>
                    <td class="mono">{v.type}</td>
                    <td class="mono">{v.format}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="note">
            Read with <code>describe using</code>;{NOTE}
          </p>
        </div>
      )}
    </div>
  );
}
