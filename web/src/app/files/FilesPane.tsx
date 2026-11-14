// The file panel (docs/design/SPEC.md, section 3.1). App.tsx draws the pane, its head ("Files") and its banners; this
// file fills the head's right side and the body.
//  - FilesHead: the head menu "File actions" (fileMenuItems): New .do file, New folder, Upload a folder, Download all
//    (.zip) (files.ts downloadAll; disabled while `hasFiles` is false), Restore the sample (OQ-13, step 5: sample.ts
//    restoreSample, an upload of the sample's files: a clash dialog with the sample's words asks about a file that differs), Delete all files… (dialog
//    delete-all).
//  - FilesBody: the tree, the dropzone ("Drop files or folders", Upload, New .do file) and "Download all (.zip)".
//    The tree (role="tree", flat rows with aria-level; tree.ts treeRows): folders first, then files, each by name;
//    folders fold (aria-expanded); sizes; the open file's mark (aria-selected); the unsaved dot; the "new" badge from
//    `fresh`. Roving focus: one row in the tab order (the one last focused, else the open file, else the first);
//    Up/Down, Home/End move; Right unfolds or goes in, Left folds or goes up; Enter (or Space, or a click) opens a file
//    through open.ts openFile or folds a folder; F2 renames in place; Shift+F10, the menu key, a right click or the
//    row's ⋯ (aria-hidden: a control inside a treeitem would be nested) open the row menu: Open, Rename (F2), Download,
//    Delete… for a file; New file here, New folder, Rename, Download (.zip), Delete… for a folder (OQ-21). There is no
//    long-press: a phone opens it by the ⋯. The head's "+" (NewFileButton) is "New .do file" in the folder of the row last focused.
//  - Inline rename (DS-7): the name becomes a field; Enter renames, Esc cancels (preventDefault, so App.tsx's Esc that
//    folds the list at 700 to 1199 px leaves it), leaving the field renames when the name can be used. A name in use
//    ("clean.do already exists here.") or one that cannot be used keeps the field open, marked aria-invalid, with the
//    reason under it. "New .do file" and "New folder" draw the name field at once, filled in `untitled.do` (`folder`; the first
//    free name), with nothing written (a draft: `renaming.draft`; OQ-21). A draft's name may be a path ("sub/x.do"). Esc writes nothing; Enter, or leaving the field,
//    writes it under the typed name, or under the free default when the name is empty or unchanged (a name that cannot be
//    used keeps the field open on Enter, and makes the default on leaving), reads the list again and, after Enter only, opens a new file.
//  - Upload: the Upload link (files), "Upload a folder" (its folders kept), or a drop anywhere on the page (SPEC 3.1; the
//    Files pane gets the accent outline while a drag with files is over the page: data-drop, OQ-16; with the list
//    folded away the files are uploaded all the same, and the toast says so). actions.ts upload() asks each clash. The
//    page's listeners take a drag with files in the capture phase and stop it there, so nothing under them (4b's
//    CodeMirror, which would paste a dropped file's text) sees it; a drop while a dialog is open, or while another tab
//    has the files (the store is blocked), uploads nothing. A drag that began in the page (a graph image) is no upload.
// Files change through the store (actions.ts), never through the worker; a change lists the store again (files.ts).
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { downloadAll, refresh } from "../files.ts";
import { restoreSample } from "../sample.ts";
import { activeTab, dialog, files, fresh, hasFiles, say, tabs } from "../state.ts";
import { store } from "../store.ts";
import { fromAnywhere, fromNothing, useFocusOnMount, useFocusRequest } from "../ui/focus-hooks.ts";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuItem, openMenu } from "../ui/Menu";
import {
  createEntry,
  downloadEntry,
  entriesOf,
  fromDrop,
  fromFileList,
  type Incoming,
  NEW_NAMES,
  renameEntry,
  upload,
} from "./actions.ts";
import { openFile } from "./open.ts";
import {
  baseName,
  formatSize,
  freeName,
  joinPath,
  NAME_NOT_ALLOWED,
  nameProblem,
  newPathProblem,
  parentOf,
  type Row,
  treeRows,
} from "./tree.ts";

// ---- the panel's own state (not shared: state.ts holds what other parts read) ----

const folded = signal<ReadonlySet<string>>(new Set()); // the folded folders
const rovingPath = signal<string | null>(null); // the row in the tab order, once one was focused
// the focus request (docs/web-page-flows.md, section 1): the row of `path` takes it when it is drawn (TreeRow), or with
// no path the row in the tab order (with no rows, the head's File actions); `anywhere`: also from outside the tree
export const focusWanted = signal<{ path: string | null; anywhere?: boolean } | null>(null); // the test hook reads it
interface Renaming {
  id: number; // which field: a commit that ends after another one began leaves it alone
  path: string; // a draft: the name it was offered, picked in the tap
  problem: string | null;
  draft?: keyof typeof NEW_NAMES; // a new file or folder: nothing is written until the field is left
}
const renaming = signal<Renaming | null>(null);
let fields = 0;

let pickFiles: HTMLInputElement | null = null; // the hidden file inputs
let pickFolder: HTMLInputElement | null = null;
let treeList: HTMLUListElement | null = null; // the tree, drawn while it has rows
const setTree = (el: HTMLUListElement | null) => {
  treeList = el;
};

/** Whether the tree is on screen with its rows (not folded away, not on another phone view, not empty). */
export const treeShown = () => (treeList?.getClientRects().length ?? 0) > 0;

/** Make `path` the row in the tab order and have it take the focus when it is drawn (at once for a row on screen; after
 *  a rename, once the store has been listed again), unless the focus has gone out of the tree by then (TreeRow). */
function focusRow(path: string) {
  rovingPath.value = path;
  focusWanted.value = { path };
}

/** Have the tree's row in the tab order take the focus when it is drawn (App's Files button with `anywhere`, a closed
 *  tab, a delete once the list was read again). */
export function focusTree(anywhere = false) {
  focusWanted.value = { path: null, anywhere };
}

/** A visitor focused or clicked the row `path`: it is the roving one, and a request for another row ends there. */
function rove(path: string) {
  rovingPath.value = path;
  if (focusWanted.value && focusWanted.value.path !== path) focusWanted.value = null;
}

const fail = (what: string, said: string) => (e: unknown) => {
  console.warn(`[dofile] ${what}: ${(e as Error)?.message ?? e}`);
  say(said);
};

function toggle(path: string, open?: boolean) {
  const next = new Set(folded.value);
  if (open ?? next.has(path)) next.delete(path);
  else next.add(path);
  folded.value = next;
}

/** Unfold `dir` and every folder above it, so a row inside it is drawn. */
function unfold(dir: string) {
  const next = new Set(folded.value);
  for (let p = dir; p; p = parentOf(p)) next.delete(p);
  folded.value = next;
}

function startRename(path: string, draft?: Renaming["draft"]) {
  renaming.value = { id: ++fields, path, problem: null, draft };
  rovingPath.value = path;
  focusWanted.value = null; // the field takes the focus: a waiting request ends
}

/** "New .do file" and "New folder", and the "+": the name field is drawn at once, in the folder `dir` (unfolded, so the
 *  row is drawn inside it), with nothing written (docs/web-page-flows.md, section 1, rule 8: on iOS the focus that raises
 *  the keyboard has to be made in the tap). endRename writes it. */
function startDraft(kind: keyof typeof NEW_NAMES, dir = "") {
  const what = kind === "file" ? "file" : "folder";
  if (store.blocked)
    return fail(`New ${what}`, `Couldn't create the ${what}`)(new Error("the files are another tab's"));
  unfold(dir);
  startRename(
    freeName(
      dir,
      NEW_NAMES[kind],
      files.value.map((f) => f.path),
    ),
    kind,
  );
}

/** The folder the "+" makes a file in (docs/web-page-flows.md, section 1): the row last focused if it is a folder, the
 *  folder of the file row last focused, else the top. */
function newFileDir(): string {
  const p = rovingPath.value;
  if (p === null) return "";
  if (files.value.some((f) => f.path.startsWith(`${p}/`) || (f.path === p && f.dir))) return p;
  return files.value.some((f) => f.path === p) ? parentOf(p) : "";
}

let ending = false; // an endRename is in progress (Enter, then the blur as the field goes)

/** Keep the field `r` open with `problem` under it, unless it has gone. */
function keepOpen(r: Renaming, problem: string) {
  if (renaming.value?.id === r.id) renaming.value = { ...r, problem };
  say(problem);
}

/** End the inline rename: `name` is the new name, or null to cancel. Keeps the field open when the name cannot be used.
 *  `leaving`: the field was left, not Enter pressed. A draft is written here, whatever the name (endDraft). */
async function endRename(name: string | null, leaving = false) {
  const r = renaming.value;
  if (!r || ending) return;
  if (r.draft) return endDraft(r, name, leaving);
  const dir = parentOf(r.path);
  const to = name === null ? r.path : joinPath(dir, name);
  if (to !== r.path) {
    const problem = nameProblem(
      name!,
      dir,
      files.value.map((f) => f.path),
      r.path,
    );
    if (problem) return keepOpen(r, problem);
    ending = true;
    try {
      await renameEntry(r.path, to);
    } catch (e) {
      // the list was not current: the store says why
      return keepOpen(
        r,
        (e as Error)?.message?.includes("already exists") ? `${name} already exists here.` : NAME_NOT_ALLOWED,
      );
    } finally {
      ending = false;
    }
  }
  if (renaming.value?.id !== r.id) return; // another field was started meanwhile
  renaming.value = null;
  focusRow(to);
}

/** The end of a draft's field. Esc writes nothing. Enter writes the typed name, or the free default (`untitled.do`,
 *  `folder`) when it is empty or unchanged; a name in use keeps the field open. Leaving the field always writes: a name
 *  that cannot be used makes the free default, and the live region says so, but nothing opens and the focus stays where
 *  the visitor tapped (docs/web-page-flows.md, rule 8). Then the list is read again, so the row replaces the draft, and
 *  after Enter a file opens and its row takes the focus. */
async function endDraft(r: Renaming, name: string | null, leaving: boolean) {
  const kind = r.draft!;
  const what = kind === "file" ? "file" : "folder";
  if (name === null) {
    renaming.value = null;
    focusTree();
    return;
  }
  const dir = parentOf(r.path);
  const asked = name.trim() === "" || name === baseName(r.path) ? undefined : name;
  let problem = asked === undefined ? null : newPathProblem(asked, dir, files.value); // a draft's name may be a path: "sub/x.do" makes sub
  if (problem && !leaving) return keepOpen(r, problem);
  ending = true;
  let to: string;
  try {
    try {
      to = await createEntry(kind, dir, problem ? undefined : asked);
    } catch (e) {
      if (asked === undefined || problem || !(e as Error)?.message?.includes("already exists")) throw e;
      problem = `${asked} already exists here.`; // the list was not current
      if (!leaving) return keepOpen(r, problem);
      to = await createEntry(kind, dir);
    }
    await refresh();
  } catch (e) {
    fail(`New ${what}`, `Couldn't create the ${what}`)(e);
    if (renaming.value?.id === r.id) {
      renaming.value = null;
      focusTree();
    }
    return;
  } finally {
    ending = false;
  }
  if (problem) say(`${problem} Made ${baseName(to)} instead.`);
  else if (asked?.includes("/")) unfold(parentOf(to)); // a folder the name went through may be folded
  if (kind === "file" && !leaving) openFile(to); // leaving: the visitor's tap decides what is open and where the focus is
  if (renaming.value?.id !== r.id) return; // another field was started meanwhile
  renaming.value = null;
  if (!leaving) focusRow(to);
}

function send(items: Promise<Incoming[]>) {
  items.then(upload).catch(fail("The upload", "The upload failed"));
}

const askDelete = (path: string) => {
  dialog.value = { d: "delete", paths: [path] };
};

/** The head menu "File actions" (S 13's caption). On a phone the Files head is hidden and App.tsx gives these to the "Files ⋯"
 *  button at the right of the phone strip while the Files view is shown. */
export const fileMenuItems = (): MenuItem[] => [
  { label: "New .do file", onSelect: () => startDraft("file") },
  { label: "New folder", onSelect: () => startDraft("folder") },
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

/** The "+": a new file in the folder of the row last focused (newFileDir). Drawn in the Files head, and in the phone's strip. */
export function NewFileButton({ class: cls }: { class: string }) {
  return (
    <button type="button" class={cls} aria-label="New file" onClick={() => startDraft("file", newFileDir())}>
      <Icon name="plus" />
    </button>
  );
}

/** A row's menu (S 13; a folder's, OQ-21). */
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
        onInput={() => {
          if (r.problem) renaming.value = { ...r, problem: null };
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            endRename(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault(); // App.tsx folds the list on an Esc nobody used
            endRename(null);
          }
        }}
        onBlur={(e) => {
          const name = e.currentTarget.value;
          if (renaming.value?.id !== r.id) return;
          if (r.draft) return void endRename(name, true); // a draft is written when the field is left
          // leaving the field: rename when the name can be used, else cancel
          const usable =
            name === row.name ||
            !nameProblem(
              name,
              parentOf(row.path),
              files.value.map((f) => f.path),
              row.path,
            );
          endRename(usable ? name : null);
        }}
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
 *  (on the page body, where the removed rename field leaves it, or in the tree) or the request says `anywhere`;
 *  docs/web-page-flows.md, section 1. */
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

function TreeRow({ row, tabbable, rows }: { row: Row; tabbable: boolean; rows: Row[] }) {
  const tab = tabs.value.find((t) => t.path === row.path);
  const open = !row.dir && activeTab.value === row.path;
  const r = renaming.value?.path === row.path ? renaming.value : null;
  const li = useRef<HTMLLIElement>(null);
  useRovingFocus(row.path, li, r !== null, tabbable);
  const showMenu = (el: HTMLElement, at?: { x: number; y: number }) =>
    openMenu({ label: menuLabel(row), items: () => rowItems(row), anchor: at ? null : el, at, restore: el });
  const activate = () => {
    if (row.dir) toggle(row.path);
    else openFile(row.path);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // keys typed in the rename field
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+Left is the browser's Back; Shift stays (Shift+F10 is the menu)
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
  const cls = [row.dir && "folder", open && "open", r && "renaming"].filter(Boolean).join(" ");
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
      aria-haspopup="menu"
      tabIndex={tabbable ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) rove(row.path);
      }}
      onClick={(e) => {
        if (r || (e.target as HTMLElement).closest(".rename-field")) return;
        rove(row.path);
        activate();
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
      {row.dir && <Icon name={row.expanded ? "down" : "right"} />}
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
              showMenu(e.currentTarget.closest("li") as HTMLElement);
            }}
          >
            <Icon name="more" />
          </span>
        </>
      )}
    </li>
  );
}

/** A drop of files anywhere on the page uploads them (SPEC 3.1). The Files pane (the closest .files-pane) is outlined
 *  while a drag with files is over the page (OQ-16); with the list folded away or on another phone view the upload still
 *  happens, and the toast says so. The listeners are the window's, in the capture phase: a drag with files stops there,
 *  so no element under them handles it too (CodeMirror pastes a dropped file's text). While a dialog is open or the store
 *  is blocked a drop uploads nothing (the browser still does not open the file). A drag that began in the page (a graph
 *  image, which Chromium and WebKit mark as carrying a file) is not an upload. */
function useDrop(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const pane = ref.current?.closest<HTMLElement>(".files-pane");
    if (!pane) return;
    // A drag that began in the page is never an upload: Chromium and WebKit list "Files" for an image dragged from it (a
    // graph on its card or full size). dragend ends it; a drop, or the mouse moving again (no mouse events fire during a drag), also
    // does, in case the dragged element was removed before its dragend.
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
  const tabbable =
    [rovingPath.value, activeTab.value].find((p) => p !== null && paths.includes(p)) ?? rows[0]?.path ?? null;
  const picked = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const list = [...(input.files ?? [])];
    input.value = "";
    if (list.length) send(fromFileList(list));
  };
  return (
    <div class="files-body" ref={ref}>
      {rows.length > 0 && (
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the tree's rows are a list's items, as ui.css draws them (.files li)
        <ul class="files" role="tree" aria-label="Files" ref={setTree}>
          {rows.map((row) => (
            <TreeRow key={row.path} row={row} rows={rows} tabbable={row.path === tabbable} />
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
        <button type="button" class="files-link" onClick={() => startDraft("file")}>
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
