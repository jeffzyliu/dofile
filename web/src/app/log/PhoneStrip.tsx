// The phone's strip (docs/design/SPEC.md, section 3.6): under the phone's top bar, on every view (the phone has no
// status bar): draws the parts of status.ts's short form. Its children go at its right end.
import type { ComponentChildren } from "preact";

import { editorCommands } from "../editor/commands.ts";
import { GraphsLoading, statusNow } from "../editor/StatusBar";
import type { StatusPart } from "../editor/status.ts";

function StripPart({ p }: { p: StatusPart }) {
  switch (p.t) {
    case "state":
      return (
        <span>
          {p.bold && <b>{p.bold}</b>}
          {p.rest}
        </span>
      );
    case "lastRun":
      return (
        <>
          {p.rc && <span class="rc-err">{p.rc}</span>}
          <span>{`${p.lead}${p.tail}`}</span>
        </>
      );
    case "memory":
      return <span title={p.title}>{p.text}</span>;
    case "spacer":
      return <span class="spacer" />;
    case "jump":
      return (
        <button type="button" class="jump" onClick={() => editorCommands.goToLine(p.line, p.path)}>
          {`Go to line ${p.line}`}
        </button>
      );
    case "graphs":
      return <GraphsLoading g={p} />;
    case "timer":
    case "affiliation":
    case "note":
      return null;
  }
}

export function PhoneStrip({ children }: { children?: ComponentChildren }) {
  return (
    <div class="phone-strip">
      {statusNow("short").map((p) => (
        <StripPart key={p.t} p={p} />
      ))}
      {children}
    </div>
  );
}
