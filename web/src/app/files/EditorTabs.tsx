// The editor's tabs (docs/design/SPEC.md, section 3.2) in the Editor pane's head, and the phone's file switcher
// (FileSwitcher). Ctrl/Cmd+W is the browser's: not bound. The tabs are editor/documents.ts's.
import { signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { activate, activeTab, askClose, save, tabs } from "../editor/documents.ts";
import { phoneTab } from "../state.ts";
import type { OpenTab } from "../types.ts";
import { useFocusRequest, useFocusTarget } from "../ui/focus-hooks.ts";
import { fromNothing } from "../ui/focus-targets.ts";
import { Icon } from "../ui/Icon";
import { roveKey } from "../ui/keys.ts";
import { closeMenu, type MenuItem, openMenu, openMenuState } from "../ui/Menu";
import { focusAfterClose } from "./close-focus.ts";
import { baseName, tabLabels } from "./tree.ts";

const tabId = (i: number) => `file-tab-${i}`;
const Unsaved = () => <span class="dot" role="img" aria-label="unsaved changes" />;

// the tab a key moved to, or the tab selected after a close: it takes the focus when it is drawn (FileTab)
const tabAsked = signal<string | null>(null);
export function EditorTabs() {
  const strip = useRef<HTMLDivElement>(null);
  const list = tabs.value;
  if (!list.length) return null;
  const labels = tabLabels(list.map((t) => t.path));
  const at = list.findIndex((t) => t.path === activeTab.value);
  const select = (i: number) => {
    tabAsked.value = list[i].path;
    activate(list[i].path);
  };
  const close = (path: string, keyboard: boolean) => {
    if (askClose(path) && keyboard) focusAfterClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+Left is the browser's Back
    const next = roveKey(e, at, list.length, { axis: "x", wrap: true });
    if (next !== null) {
      e.preventDefault();
      select(next);
    } else if (e.key === "Delete" && at >= 0) {
      e.preventDefault();
      close(list[at].path, true);
    }
  };
  return (
    <div ref={strip} role="tablist" aria-label="Open files" class="tabstrip file-tabs" onKeyDown={onKeyDown}>
      {list.map((t, i) => (
        <FileTab key={t.path} t={t} i={i} at={at} label={labels[i]} close={close} list={strip} />
      ))}
    </div>
  );
}

/** One tab of "Open files"; it takes the focus when a key of the tablist asked for it (docs/web-page-flows.md, section
 *  1). */
function FileTab({
  t,
  i,
  at,
  label,
  close,
  list,
}: {
  t: OpenTab;
  i: number;
  at: number;
  label: string;
  close: (path: string, keyboard: boolean) => void;
  list: { current: HTMLElement | null };
}) {
  const el = useRef<HTMLDivElement>(null);
  useFocusTarget("open-file-tab", () => (i === at ? el.current : null));
  useFocusRequest(
    tabAsked.value === t.path,
    el,
    () => {
      tabAsked.value = null;
    },
    // a closed tab leaves the focus on nothing
    (focused) => fromNothing(focused) || !!list.current?.contains(focused),
  );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are the tablist's (arrows, Home, End, Delete); a tab holds the × (a click target of its own), so it is not a button
    <div
      ref={el}
      id={tabId(i)}
      role="tab"
      class={`tab${i === at ? " on" : ""}`}
      aria-selected={i === at}
      aria-keyshortcuts="Delete"
      tabIndex={i === at || (at < 0 && i === 0) ? 0 : -1}
      title={t.path}
      onClick={() => {
        activate(t.path);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) close(t.path, false); // the middle button, as browsers' own tabs
      }}
    >
      <span class="tl" data-label={label}>
        {label}
      </span>
      {t.dirty && <Unsaved />}
      <span
        class="x"
        aria-hidden="true"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          close(t.path, false);
        }}
      >
        ×
      </span>
    </div>
  );
}

const switcherItems = (): MenuItem[] => {
  const list = tabs.value;
  const labels = tabLabels(list.map((t) => t.path));
  const active = activeTab.value;
  return [
    {
      label: "Save",
      disabled: tabs.value.find((t) => t.path === active)?.kind !== "text", // as the toolbar's Save
      onSelect: () => {
        save();
      },
    },
    "rule",
    // the tab list scrolls (many open files); Save above and Close below stay in reach
    {
      scroll: list.map(
        (t, i): MenuItem => ({
          label: (
            <span class="switch-item">
              {labels[i]}
              {t.dirty && <Unsaved />}
            </span>
          ),
          hint: t.path === active ? "open" : undefined,
          current: t.path === active,
          onSelect: () => {
            activate(t.path);
          },
        }),
      ),
    },
    ...(list.length ? ["rule" as const] : []),
    ...(active ? [{ label: `Close ${baseName(active)}`, onSelect: () => askClose(active) }] : []),
    {
      label: "Show all files",
      onSelect: () => {
        phoneTab.value = "files";
      },
    },
  ];
};

/** The phone's top bar title on the Editor view: the open file's name (or "Editor" with none) and ▾; a tap opens the
 *  menu. One button in every case, as wide as the title, so the top bar's boxes never move (e2e/shell.spec.ts). */
export function FileSwitcher() {
  const active = tabs.value.find((t) => t.path === activeTab.value);
  const label = active ? tabLabels(tabs.value.map((t) => t.path))[tabs.value.indexOf(active)] : "Editor";
  const open = openMenuState.value?.label === "Open files";
  return (
    <button
      type="button"
      class="file-switcher"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`${label}${active?.dirty ? ", unsaved changes" : ""}. Open files`}
      onClick={(e) =>
        open ? closeMenu() : openMenu({ label: "Open files", items: switcherItems, anchor: e.currentTarget })
      }
    >
      <span class="name">{label}</span>
      {active?.dirty && <span class="dot" aria-hidden="true" />}
      <Icon name="down" />
    </button>
  );
}
