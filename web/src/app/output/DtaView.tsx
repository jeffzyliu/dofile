// A .dta file's tab (docs/design/SPEC.md, section 3.11): two bars (the file's facts; the `use` command with Load and
// Copy) and the variables table. The table comes from call("describe_file", { path }): the file is read apart, so the
// data in memory, r() and the log stay untouched until Load. What was read stays in view.ts `dtaInfo`, since this view
// is unmounted when another tab is made active.

import { useEffect } from "preact/hooks";
import { fileCommand } from "../../stata/quote.ts";
import { call } from "../engine.ts";
import { baseName, formatSize } from "../files/tree.ts";
import { runCommand } from "../run.ts";
import { startFirst, startOffer } from "../start.ts";
import { engine, files, showToast } from "../state.ts";
import { Icon } from "../ui/Icon";
import { copyText } from "./clip.ts";
import { count } from "./format.ts";
import { dtaInfo } from "./view.ts";

const NOTE = " the data in memory is untouched until you press Load.";
// engine states in which a worker is there, or on its way, to answer a read
const UP = new Set(["starting-worker", "ready", "running", "breaking", "waiting"]);

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
  const offer = startOffer(engine.value),
    off = offer !== null; // Load is off (aria-disabled, still focusable) and says why in a toast when pressed
  const load = async () => {
    if (command === null) return;
    const name = baseName(path);
    if (offer !== null) {
      showToast(startFirst(offer, `load ${name}`), "error");
      return;
    }
    const run = runCommand(command);
    if (run.how !== "started") return; // it did not run: refused
    const r = await run.done;
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
          class={`btn primary${off ? " off" : ""}`}
          disabled={command === null || (!off && engine.value.s !== "ready")}
          aria-disabled={off ? "true" : undefined}
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
