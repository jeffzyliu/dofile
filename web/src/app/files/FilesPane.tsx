// The file panel (docs/design/SPEC.md, section 3.1): the head menu and the body (tree, dropzone). The rows, keys,
// rename and drafts follow SPEC 3.1 and docs/web-page-flows.md. Files change through the store (ops.ts, upload.ts), never the
// worker.
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { formatSize } from "../bytes.ts";
import { activeTab, tabs } from "../editor/documents.ts";
import { downloadAll } from "../files.ts";
import { restoreSample } from "../sample.ts";
import { dialog, files, fresh, hasFiles } from "../state.ts";
import { store } from "../store.ts";
import { fromAnywhere, fromNothing, useFocusOnMount, useFocusRequest } from "../ui/focus-hooks.ts";
import { Icon } from "../ui/Icon";
import { closeMenu, MenuButton, type MenuItem, openMenu, openMenuState } from "../ui/Menu";
import { entriesOf, fromDrop, fromFileList } from "./intake.ts";
import { openFile } from "./open.ts";
import { downloadEntry, fail } from "./ops.ts";
import { clearProblem, endRename, leaveField, type Renaming, renaming, startDraft, startRename } from "./rename.ts";
import { parentOf, type Row, treeRows } from "./tree.ts";
import {
  currentDir,
  focusRow,
  focusWanted,
  folded,
  newFileDir,
  rove,
  rovingPath,
  setTree,
  toggle,
} from "./tree-state.ts";
import { type Incoming, upload } from "./upload.ts";

let pickFiles: HTMLInputElement | null = null; // the hidden file inputs
let pickFolder: HTMLInputElement | null = null;

function send(items: Promise<Incoming[]>) {
  upload(items).catch(fail("The upload", "The upload failed")); // in its place in the queue now, before its read ends
}

const askDelete = (path: string) => {
  dialog.value = { d: "delete", paths: [path] };
};

/** The head menu "File actions". */
export const fileMenuItems = (): MenuItem[] => [
  { label: "New .do file", onSelect: () => startDraft("file", newFileDir()) },
  { label: "New folder", onSelect: () => startDraft("folder", newFileDir()) },
  { label: "Upload files", onSelect: () => pickFiles?.click() },
  { label: "Upload a folder", onSelect: () => pickFolder?.click() },
  {
    label: "Download all (.zip)",
    disabled: !hasFiles.value,
    onSelect: () => {
      downloadAll();
    },
  },
  "rule",
  {
    label: "Restore the sample",
    onSelect: () => {
      restoreSample();
    },
  },
  {
    label: "Delete all files…",
    danger: true,
    disabled: !hasFiles.value,
    onSelect: () => {
      dialog.value = { d: "delete-all", count: files.value.filter((f) => !f.dir).length };
    },
  },
];

export function FilesHead() {
  const button = useRef<HTMLButtonElement>(null);
  const w = focusWanted.value;
  // with no rows a request for the row in the tab order comes here, File actions
  useFocusRequest(
    w?.path === null && !files.value.length,
    button,
    () => {
      focusWanted.value = null;
    },
    w?.anywhere ? fromAnywhere : fromNothing,
  );
  return (
    <>
      <NewFileButton class="head-link icon" />
      <MenuButton ref={button} label="File actions" class="head-link icon" items={fileMenuItems}>
        <Icon name="more" />
      </MenuButton>
    </>
  );
}

/** The "+": a new file in the current folder (newFileDir). */
export function NewFileButton({ class: cls }: { class: string }) {
  const dir = newFileDir();
  const label = dir ? `New file in ${dir}/` : "New file";
  return (
    <button type="button" class={cls} aria-label={label} onClick={() => startDraft("file", dir)}>
      <Icon name="plus" />
    </button>
  );
}

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

function RenameField({ r, row }: { r: Renaming; row: Row }) {
  const field = useRef<HTMLInputElement>(null);
  useFocusOnMount(field);
  useLayoutEffect(() => {
    const dot = row.dir ? -1 : row.name.lastIndexOf(".");
    field.current?.setSelectionRange(0, dot > 0 ? dot : row.name.length); // the name without its extension
  }, []);
  return (
    <>
      <input
        class="rename-field"
        aria-label={`New name for ${row.name}`}
        aria-invalid={r.problem ? "true" : undefined}
        aria-describedby={r.problem ? "rename-problem" : undefined}
        defaultValue={row.name}
        spellcheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        ref={field}
        onInput={() => clearProblem(r)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            endRename(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault(); // App.tsx folds the list on an Esc nobody used
            endRename(null);
          }
        }}
        onBlur={(e) => leaveField(r, e.currentTarget.value)}
      />
      {r.problem && (
        <span class="rename-problem" id="rename-problem">
          {r.problem}
        </span>
      )}
    </>
  );
}

/** A row asked for (by its path, or as the row in the tab order) takes the focus once it is drawn, if the focus is free
 *  (on the page body, where the removed rename field leaves it, or in the tree) or the request says `anywhere`. */
function useRovingFocus(path: string, li: { current: HTMLElement | null }, renaming: boolean, tabbable: boolean) {
  const w = focusWanted.value;
  useFocusRequest(
    !!w && (w.path === null ? tabbable : w.path === path) && !renaming, // a row being renamed waits for the field to go
    li,
    () => {
      focusWanted.value = null;
    },
    w?.anywhere ? fromAnywhere : (at) => fromNothing(at) || !!li.current?.closest('[role="tree"]')?.contains(at),
  );
}

function TreeRow({ row, tabbable, current, rows }: { row: Row; tabbable: boolean; current: boolean; rows: Row[] }) {
  const tab = tabs.value.find((t) => t.path === row.path);
  const open = !row.dir && activeTab.value === row.path;
  const r = renaming.value?.path === row.path ? renaming.value : null;
  const li = useRef<HTMLLIElement>(null);
  useRovingFocus(row.path, li, r !== null, tabbable);
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
  const cls = [row.dir && "folder", open && "open", current && "current", r && "renaming"].filter(Boolean).join(" ");
  return (
    <li
      ref={li}
      role="treeitem"
      class={cls || undefined}
      style={row.depth ? { "--d": row.depth } : undefined}
      title={r ? undefined : row.path}
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
        if (r || (e.target as HTMLElement).closest(".rename-field")) return;
        rove(row.path);
        // a second tap on the current folder: the top; not the second click of a double-click, which means "open it"
        if (row.dir && currentDir.value === row.path) {
          if (e.detail < 2) currentDir.value = "";
        } else activate();
      }}
      onContextMenu={(e) => {
        if (r) return;
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
      {r ? (
        <RenameField key={r.id} r={r} row={row} /> // a field started over this one is a new field: it takes the focus
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

/** A drop of files anywhere on the page uploads them. The listeners are the window's, in the capture phase: a drag with
 *  files stops there, so nothing under them sees it (CodeMirror would paste a dropped file's text). A drop uploads
 *  nothing while a dialog is open or the store is blocked (the browser still does not open the file). With the list
 *  folded away or on another phone view the upload still happens, and the toast says so. */
function useDrop(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const pane = ref.current?.closest<HTMLElement>(".files-pane");
    if (!pane) return;
    // A drag that began in the page is never an upload: Chromium and WebKit list "Files" for an image dragged from it
    // (a graph). dragend ends it; so does a drop, or the mouse moving again (no mouse events fire during a drag), in
    // case the dragged element was removed before its dragend.
    let inPage = false;
    const started = () => {
      inPage = true;
    };
    const ended = () => {
      inPage = false;
    };
    const withFiles = (e: DragEvent) => !inPage && Boolean(e.dataTransfer?.types.includes("Files"));
    let depth = 0; // dragenter and dragleave fire for each element inside: count them
    const mark = (on: boolean) => {
      if (on) pane.dataset.drop = "";
      else delete pane.dataset.drop;
    };
    const taken = () => dialog.value !== null || store.blocked; // no upload now
    const enter = (e: DragEvent) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth++;
      mark(!taken());
    };
    const over = (e: DragEvent) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = taken() ? "none" : "copy";
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) mark(false);
    };
    const drop = (e: DragEvent) => {
      if (!withFiles(e) || !e.dataTransfer) {
        ended();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      mark(false);
      if (taken()) return;
      send(fromDrop(entriesOf(e.dataTransfer))); // the entries are taken now: the items are gone after this handler
    };
    const on = [
      ["dragstart", started],
      ["dragend", ended],
      ["mousemove", ended],
      ["dragenter", enter],
      ["dragover", over],
      ["dragleave", leave],
      ["drop", drop],
    ] as [string, EventListener][];
    for (const [type, fn] of on) addEventListener(type, fn, true);
    return () => {
      for (const [type, fn] of on) removeEventListener(type, fn, true);
      mark(false);
    };
  }, []);
}

export function FilesBody() {
  const ref = useRef<HTMLDivElement>(null);
  useDrop(ref);
  const draft = renaming.value?.draft ? renaming.value : null;
  // a draft is a row of its own before anything is written; a real file at its path hides it (treeRows keeps the last)
  const rows = treeRows(
    draft ? [{ path: draft.path, dir: draft.draft === "folder", size: 0, mtime: 0 }, ...files.value] : files.value,
    folded.value,
  );
  const paths = rows.map((r) => r.path);
  const here = newFileDir(); // the current folder, as the "+" takes it: one that has gone is its nearest folder above
  const tabbable =
    [rovingPath.value, activeTab.value].find((p) => p !== null && paths.includes(p)) ?? rows[0]?.path ?? null;
  const picked = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const list = [...(input.files ?? [])];
    input.value = "";
    if (list.length) send(fromFileList(list));
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a tap on the empty space (not the pickers' hidden inputs, whose synthetic click bubbles here) makes the top the current folder; the keyboard has no such stop (Left on a top-level folder does it)
    <div
      class="files-body"
      ref={ref}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[role="treeitem"], button, input')) currentDir.value = "";
      }}
    >
      {rows.length > 0 && (
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the tree's rows are a list's items, as ui.css draws them (.files li)
        <ul class="files" role="tree" aria-label="Files" ref={setTree}>
          {rows.map((row) => (
            <TreeRow
              key={row.path}
              row={row}
              rows={rows}
              tabbable={row.path === tabbable}
              current={row.dir && row.path === here}
            />
          ))}
        </ul>
      )}
      <div class="dropzone">
        Drop files or folders
        <br />
        <button type="button" class="files-link" onClick={() => pickFiles?.click()}>
          Upload
        </button>
        {" · "}
        <button type="button" class="files-link" onClick={() => startDraft("file", newFileDir())}>
          New .do file
        </button>
      </div>
      <div class="files-foot">
        <button
          type="button"
          class="files-link"
          disabled={!hasFiles.value}
          onClick={() => {
            downloadAll();
          }}
        >
          Download all (.zip)
        </button>
      </div>
      <input
        type="file"
        multiple
        hidden
        data-upload="files"
        tabIndex={-1}
        ref={(el) => {
          pickFiles = el;
        }}
        onChange={picked}
      />
      <input
        type="file"
        hidden
        data-upload="folder"
        tabIndex={-1}
        ref={(el) => {
          pickFolder = el;
          el?.setAttribute("webkitdirectory", ""); // a folder, its paths kept (webkitRelativePath)
        }}
        onChange={picked}
      />
    </div>
  );
}
