// The editor's tabs (docs/design/SPEC.md, section 3.2), in the Editor pane's head, and the phone's file switcher.
//  - EditorTabs: role="tablist" aria-label="Open files"; one tab per open file (`tabs`, `activeTab`) with its name (and
//    its folder when two open files share a name), the unsaved dot (role img, "unsaved changes") and the × (mouse only,
//    aria-hidden). Roving focus: the active tab is in the tab order; Left/Right, Home/End move and select; Delete closes
//    the selected tab (aria-keyshortcuts="Delete"). Closing a tab with unsaved edits asks first (dialog close-tab:
//    actions.ts askCloseTab). Ctrl/Cmd+W is the browser's: not bound. After a tab closes from the keyboard or the
//    close-tab dialog, the focus goes to the tab now selected; with none left, to the file tree's row in the tab order
//    (when the list is shown), else to the editor (focusAfterClose).
//  - FileSwitcher: the phone's top bar title on the Editor view (WP 1): the open file's name and ▾, a menu: Save (off unless
//    the open file is a text file), the open files (a list that scrolls), "Close <name>" (the phone has no ×) and "Show all files"; with no open file it says "Editor".
// `dirty` is the editor's (state.ts setDirty); this file never sets it.
import { signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { editorCommands } from "../editor/commands.ts";
import { activeTab, phoneTab, tabs } from "../state.ts";
import type { OpenTab } from "../types.ts";
import { useFocusRequest } from "../ui/focus-hooks.ts";
import { Icon } from "../ui/Icon";
import { type MenuItem, openMenu, openMenuState } from "../ui/Menu";
import { askCloseTab } from "./actions.ts";
import { baseName, tabLabels } from "./tree.ts";

const tabId = (i: number) => `file-tab-${i}`;
const Unsaved = () => <span class="dot" role="img" aria-label="unsaved changes" />;

// the tab a key moved to: it takes the focus when it is drawn (FileTab)
const tabAsked = signal<string | null>(null);

const shown = (el: HTMLElement | null): el is HTMLElement => el !== null && el.getClientRects().length > 0;

/** After a tab closed (its element, which may have had the focus, is gone): focus the selected tab, else the file
 *  tree's row in the tab order when the list is shown, else the editor; never the page itself. */
export function focusAfterClose() {
  setTimeout(() => {
    const i = tabs.value.findIndex((t) => t.path === activeTab.value);
    const tab = i >= 0 ? document.getElementById(tabId(i)) : null;
    const row = document.querySelector<HTMLElement>('.files [role="treeitem"][tabindex="0"]');
    if (shown(tab)) tab.focus();
    else if (shown(row)) row.focus();
    else editorCommands.focus();
  });
}

export function EditorTabs() {
  const strip = useRef<HTMLDivElement>(null);
  const list = tabs.value;
  if (!list.length) return null;
  const labels = tabLabels(list.map((t) => t.path));
  const at = list.findIndex((t) => t.path === activeTab.value);
  const select = (i: number) => {
    tabAsked.value = list[i].path;
    activeTab.value = list[i].path;
  };
  const close = (path: string, keyboard: boolean) => {
    if (askCloseTab(path) && keyboard) focusAfterClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+Left is the browser's Back
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      select((next + list.length) % list.length);
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

/** One tab of "Open files"; it takes the focus when a key of the tablist asked for it (docs/web-page-flows.md, section 1). */
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
  useFocusRequest(
    tabAsked.value === t.path,
    el,
    () => {
      tabAsked.value = null;
    },
    (focused) => !!focused && !!list.current?.contains(focused),
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
        activeTab.value = t.path;
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
        editorCommands.save();
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
            activeTab.value = t.path;
          },
        }),
      ),
    },
    ...(list.length ? ["rule" as const] : []),
    ...(active ? [{ label: `Close ${baseName(active)}`, onSelect: () => askCloseTab(active) }] : []),
    {
      label: "Show all files",
      onSelect: () => {
        phoneTab.value = "files";
      },
    },
  ];
};

/** The phone's top bar title on the Editor view: the open file's name (or "Editor" with none) and ▾; a tap opens the
 *  menu: Save, the open files, "Close <name>" and "Show all files" (the Files view). One button in every case, as wide as the
 *  title, so the top bar's boxes never move (e2e/shell.spec.ts). */
export function FileSwitcher() {
  const active = tabs.value.find((t) => t.path === activeTab.value);
  const label = active ? tabLabels(tabs.value.map((t) => t.path))[tabs.value.indexOf(active)] : "Editor";
  return (
    <button
      type="button"
      class="file-switcher"
      aria-haspopup="menu"
      aria-expanded={openMenuState.value?.label === "Open files"}
      aria-label={`${label}${active?.dirty ? ", unsaved changes" : ""}. Open files`}
      onClick={(e) => openMenu({ label: "Open files", items: switcherItems, anchor: e.currentTarget })}
    >
      <span class="name">{label}</span>
      {active?.dirty && <span class="dot" aria-hidden="true" />}
      <Icon name="down" />
    </button>
  );
}
