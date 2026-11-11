// The editor's tabs (docs/design/SPEC.md, section 3.2), in the Editor pane's head, and the phone's file switcher.
//  - EditorTabs: role="tablist" aria-label="Open files"; one tab per open file (`tabs`, `activeTab`) with its name (and
//    its folder when two open files share a name), the unsaved dot (role img, "unsaved changes") and the × (mouse only,
//    aria-hidden). Roving focus: the active tab is in the tab order; Left/Right, Home/End move and select; Delete closes
//    the selected tab (aria-keyshortcuts="Delete"). Closing a tab with unsaved edits asks first (dialog close-tab:
//    actions.ts askCloseTab). Ctrl/Cmd+W is the browser's: not bound.
//  - FileSwitcher: the phone's top bar title on the Editor view (WP 1): the open file's name and ▾, a menu of the open
//    files, and "Close <name>" (the phone has no ×). With no open file the title is "Editor".
// `dirty` is the editor's (state.ts setDirty); this file never sets it.
import { activeTab, tabs } from "../state.ts";
import { Icon } from "../ui/Icon";
import { type MenuItem, openMenu, openMenuState } from "../ui/Menu";
import { askCloseTab } from "./actions.ts";
import { baseName, tabLabels } from "./tree.ts";

const tabId = (i: number) => `file-tab-${i}`;
const Unsaved = () => <span class="dot" role="img" aria-label="unsaved changes" />;

/** Focus the tab of `path` after the render that draws it. */
function focusTab(path: string | null) {
  setTimeout(() => {
    const i = tabs.value.findIndex((t) => t.path === path);
    document.getElementById(tabId(i))?.focus();
  });
}

export function EditorTabs() {
  const list = tabs.value;
  if (!list.length) return null;
  const labels = tabLabels(list.map((t) => t.path));
  const at = list.findIndex((t) => t.path === activeTab.value);
  const select = (i: number) => {
    activeTab.value = list[i].path;
    focusTab(list[i].path);
  };
  const close = (path: string, keyboard: boolean) => {
    if (askCloseTab(path) && keyboard) focusTab(activeTab.value);
  };
  const onKeyDown = (e: KeyboardEvent) => {
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
    <div role="tablist" aria-label="Open files" class="tabstrip file-tabs" onKeyDown={onKeyDown}>
      {list.map((t, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are the tablist's (arrows, Home, End, Delete); a tab holds the × (a click target of its own), so it is not a button
        <div
          key={t.path}
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
          {labels[i]}
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
      ))}
    </div>
  );
}

const switcherItems = (): MenuItem[] => {
  const list = tabs.value;
  const labels = tabLabels(list.map((t) => t.path));
  const active = activeTab.value;
  return [
    ...list.map(
      (t, i): MenuItem => ({
        label: (
          <span class="switch-item">
            {labels[i]}
            {t.dirty && <Unsaved />}
          </span>
        ),
        hint: t.path === active ? "open" : undefined,
        onSelect: () => {
          activeTab.value = t.path;
        },
      }),
    ),
    ...(active
      ? (["rule", { label: `Close ${baseName(active)}`, onSelect: () => askCloseTab(active) }] as MenuItem[])
      : []),
  ];
};

/** The phone's top bar title on the Editor view: the open file's name and ▾; a tap opens the menu of open files. */
export function FileSwitcher() {
  const active = tabs.value.find((t) => t.path === activeTab.value);
  if (!active) return <>Editor</>;
  const label = tabLabels(tabs.value.map((t) => t.path))[tabs.value.indexOf(active)];
  return (
    <button
      type="button"
      class="file-switcher"
      aria-haspopup="menu"
      aria-expanded={openMenuState.value?.label === "Open files"}
      aria-label={`${label}${active.dirty ? ", unsaved changes" : ""}. Open files`}
      onClick={(e) => openMenu({ label: "Open files", items: switcherItems, anchor: e.currentTarget })}
    >
      <span class="name">{label}</span>
      {active.dirty && <span class="dot" aria-hidden="true" />}
      <Icon name="down" />
    </button>
  );
}
