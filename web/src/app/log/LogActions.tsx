// The Log head's actions (docs/design/SPEC.md, section 3.5): three links (.log-link) and one "Log actions" ⋯ menu
// button (.log-more); ui.css shows one by a container query on the head's width (the unsplit head only), so the tabs
// are never clipped. The phone hides the Log head, so the same logMenuItems() are the "Log ⋯" button in its strip.
import { saveAs } from "../files/save.ts";
import { canClearLog } from "../run.ts";
import { openDialog } from "../state/notices.ts";
import { log } from "../state/run.ts";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuItem } from "../ui/Menu";
import { plainLog } from "./classify.ts";
import { openFind } from "./find.ts";

function downloadLog() {
  saveAs(new Blob([plainLog(log.value)], { type: "text/plain" }), "dofile.log");
}

/** Asks first (ClearLogDialog): the log and the graphs cannot be brought back. */
const askClearLog = () => {
  openDialog({ d: "clear-log" });
};

export const LogActions = () => (
  <>
    <button type="button" class="head-link log-link" onClick={(e) => openFind(e.currentTarget as HTMLElement)}>
      Find
    </button>
    <button type="button" class="head-link log-link" onClick={downloadLog}>
      Download log
    </button>
    <button
      type="button"
      class="head-link log-link danger"
      aria-label="Clear log…"
      disabled={!canClearLog()}
      onClick={askClearLog}
    >
      Clear…
    </button>
    <MenuButton label="Log actions" class="head-link icon log-more" items={logMenuItems}>
      <Icon name="more" />
    </MenuButton>
  </>
);

/** The Log head's actions as menu items, in the head's order. */
export const logMenuItems = (): MenuItem[] => [
  { label: "Find", onSelect: () => openFind(null) },
  { label: "Download log", onSelect: downloadLog },
  { label: "Clear log…", danger: true, disabled: !canClearLog(), onSelect: askClearLog },
];
