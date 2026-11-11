// STEP 4b: the log (docs/design/SPEC.md, section 3.5). Reads `log` (LogItem[], run.js writes it) and draws it: the head
// (banner B2, the About line), run-heads, the text split into echo, output, note, error and hint lines by the .log
// tokenizer (OQ-4), "Go to line N", each graph's link after the echo on its line (desktop) or the graph inline (phone),
// and the page's own notes. It follows the end unless the user scrolled up. role="log".
// What step 3 left here is the plainest view of the same items, so the shell can be run and tested: replace it.
import { log } from "../state.js";

export function LogView() {
  return (
    <pre class="log" role="log" aria-label="Log">
      {log.value.map((item, i) => {
        if (item.t === "text" || item.t === "note") return <span key={i} class={item.t === "note" ? "note" : undefined}>{item.text}</span>;
        if (item.t === "runhead") return <span key={i} class="runhead">{item.run.kind === "file" ? "Run" : "Run selection"}</span>;
        if (item.t === "graph") return <span key={i} class="glink">graph {item.n}</span>;
        return null;
      })}
    </pre>
  );
}
