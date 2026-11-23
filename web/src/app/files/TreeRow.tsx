// A row of the file tree and its inline rename field (docs/design/SPEC.md, section 3.1). The keys follow
// docs/web-page-flows.md; the rename and the draft rows end in rename.ts.
import { useLayoutEffect, useRef } from "preact/hooks";
import { formatSize } from "../bytes.ts";
import { activeTab, tabs } from "../editor/documents.ts";
import { dialog, fresh } from "../state.ts";
import { fromAnywhere, fromNothing, useFocusOnMount, useFocusRequest } from "../ui/focus-hooks.ts";
import { Icon } from "../ui/Icon";
import { closeMenu, type MenuItem, openMenu, openMenuState } from "../ui/Menu";
import { openFile } from "./open.ts";
import { downloadEntry } from "./ops.ts";
import { clearProblem, endRename, leaveField, type Renaming, renaming, startDraft, startRename } from "./rename.ts";
import { parentOf, type Row } from "./tree.ts";
import { currentDir, focusRow, focusWanted, rove, toggle } from "./tree-state.ts";

const askDelete = (path: string) => {
  dialog.value = { d: "delete", paths: [path] };
};

function rowItems(row: Row): MenuItem[] {
  const rename = { label: "Rename", hint: "F2", hintIsKey: true, onSelect: () => startRename(row.path) };
  const remove: MenuItem = { label: "Delete…", danger: true, onSelect: () => askDelete(row.path) };
  const download = (label: string): MenuItem => ({
    label,
    onSelect: () => {
      downloadEntry(row.path);
    },
  });
  if (row.dir)
    return [
      { label: "New file here", onSelect: () => startDraft("file", row.path) },
      { label: "New folder", onSelect: () => startDraft("folder", row.path) },
      "rule",
      rename,
      download("Download (.zip)"),
      "rule",
      remove,
    ];
  return [
    {
      label: "Open",
      onSelect: () => {
        openFile(row.path);
      },
    },
    rename,
    download("Download"),
    "rule",
    remove,
  ];
}

const menuLabel = (row: Row) => `Actions for ${row.path}${row.dir ? "/" : ""}`;

function RenameField({ field, row }: { field: Renaming; row: Row }) {
  const input = useRef<HTMLInputElement>(null);
  useFocusOnMount(input);
  useLayoutEffect(() => {
    const dot = row.dir ? -1 : row.name.lastIndexOf(".");
    input.current?.setSelectionRange(0, dot > 0 ? dot : row.name.length); // the name without its extension
  }, []);
  return (
    <>
      <input
        class="rename-field"
        aria-label={`New name for ${row.name}`}
        aria-invalid={field.problem ? "true" : undefined}
        aria-describedby={field.problem ? "rename-problem" : undefined}
        defaultValue={row.name}
        spellcheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        ref={input}
        onInput={() => clearProblem(field)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            endRename(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault(); // App.tsx folds the list on an Esc nobody used
            endRename(null);
          }
        }}
        onBlur={(e) => leaveField(field, e.currentTarget.value)}
      />
      {field.problem && (
        <span class="rename-problem" id="rename-problem">
          {field.problem}
        </span>
      )}
    </>
  );
}

/** A row asked for (by its path, or as the row in the tab order) takes the focus once it is drawn, if the focus is free
 *  (on the page body, where the removed rename field leaves it, or in the tree) or the request says `anywhere`. */
function useRovingFocus(path: string, li: { current: HTMLElement | null }, isRenaming: boolean, tabbable: boolean) {
  const w = focusWanted.value;
  useFocusRequest(
    !!w && (w.path === null ? tabbable : w.path === path) && !isRenaming, // a row being renamed waits for the field to go
    li,
    () => {
      focusWanted.value = null;
    },
    w?.anywhere ? fromAnywhere : (at) => fromNothing(at) || !!li.current?.closest('[role="tree"]')?.contains(at),
  );
}

export function TreeRow({
  row,
  tabbable,
  current,
  rows,
}: {
  row: Row;
  tabbable: boolean;
  current: boolean;
  rows: Row[];
}) {
  const tab = tabs.value.find((t) => t.path === row.path);
  const open = !row.dir && activeTab.value === row.path;
  const field = renaming.value?.path === row.path ? renaming.value : null;
  const li = useRef<HTMLLIElement>(null);
  useRovingFocus(row.path, li, field !== null, tabbable);
  const showMenu = (el: HTMLElement, at?: { x: number; y: number }, anchor: HTMLElement | null = at ? null : el) =>
    openMenu({ label: menuLabel(row), items: () => rowItems(row), anchor, at, restore: el });
  // a folder is made current and unfolded, never folded (its caret and Left fold it); a file opens, and its folder is
  // current
  const activate = () => {
    if (row.dir) {
      currentDir.value = row.path;
      toggle(row.path, true);
    } else {
      openFile(row.path);
      currentDir.value = parentOf(row.path);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // keys typed in the rename field
    // Alt+Left is the browser's Back; Shift stays (Shift+F10 is the menu)
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = rows.indexOf(row);
    const go = (j: number) => {
      e.preventDefault();
      const to = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (to) focusRow(to.path);
    };
    switch (e.key) {
      case "ArrowDown":
        return go(i + 1);
      case "ArrowUp":
        return go(i - 1);
      case "Home":
        return go(0);
      case "End":
        return go(rows.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (row.dir && !row.expanded) toggle(row.path, true);
        else if (row.dir && rows[i + 1]?.depth > row.depth) go(i + 1);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (row.dir && row.expanded) return toggle(row.path, false);
        const parent = parentOf(row.path);
        if (parent) focusRow(parent);
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        return activate();
      case "F2":
        e.preventDefault();
        return startRename(row.path);
      case "ContextMenu":
        e.preventDefault();
        return showMenu(e.currentTarget as HTMLElement);
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          showMenu(e.currentTarget as HTMLElement);
        }
        return;
    }
  };
  const cls = [row.dir && "folder", open && "open", current && "current", field && "renaming"]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      ref={li}
      role="treeitem"
      class={cls || undefined}
      style={row.depth ? { "--d": row.depth } : undefined}
      title={field ? undefined : row.path}
      aria-level={row.depth + 1}
      aria-expanded={row.dir ? row.expanded : undefined}
      aria-selected={row.dir ? undefined : open}
      aria-current={current ? "true" : undefined}
      aria-haspopup="menu"
      tabIndex={tabbable ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) rove(row.path);
      }}
      onClick={(e) => {
        if (field || (e.target as HTMLElement).closest(".rename-field")) return;
        rove(row.path);
        // a second tap on the current folder: the top; not the second click of a double-click, which means "open it"
        if (row.dir && currentDir.value === row.path) {
          if (e.detail < 2) currentDir.value = "";
        } else activate();
      }}
      onContextMenu={(e) => {
        if (field) return;
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        // a context menu from the keyboard comes with no pointer position: the menu goes under the row
        showMenu(el, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined);
      }}
      onKeyDown={onKeyDown}
    >
      {row.dir && (
        // aria-hidden like the ⋯ (a control inside a treeitem would be nested); the keys do its job
        <span
          class="caret"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            toggle(row.path);
          }}
        >
          <Icon name={row.expanded ? "down" : "right"} />
        </span>
      )}
      {field ? (
        <RenameField key={field.id} field={field} row={row} /> // a field started over this one is a new field: it takes the focus
      ) : (
        <>
          <span class="name">
            {row.name}
            {row.dir && "/"}
          </span>
          {tab?.dirty && <span class="dot" role="img" aria-label="unsaved changes" />}
          {!row.dir && fresh.value.has(row.path) && <span class="badge">new</span>}
          {!row.dir && <span class="size">{formatSize(row.size)}</span>}
          <span
            class="row-more"
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              // the menu hangs from the ⋯ and a second tap on it closes it, as a MenuButton
              const more = e.currentTarget;
              if (openMenuState.value?.anchor === more) closeMenu();
              else showMenu(more.closest("li") as HTMLElement, undefined, more);
            }}
          >
            <Icon name="more" />
          </span>
        </>
      )}
    </li>
  );
}
