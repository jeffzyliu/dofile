// The file panel (docs/design/SPEC.md, section 3.1): the head menu and the body (tree, dropzone). Files change through the
// store (ops.ts, upload.ts), never the worker.
import { useRef } from "preact/hooks";
import { activeTab } from "../editor/documents.ts";
import { downloadAll } from "../files.ts";
import { restoreSample } from "../sample.ts";
import { dialog, files, hasFiles } from "../state.ts";
import { useFocusRequest } from "../ui/focus-hooks.ts";
import { fromAnywhere, fromNothing } from "../ui/focus-targets.ts";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuItem } from "../ui/Menu";
import { send, useDrop } from "./drop.ts";
import { fromFileList } from "./intake.ts";
import { renaming, startDraft } from "./rename.ts";
import { TreeRow } from "./TreeRow.tsx";
import { treeRows } from "./tree.ts";
import { currentDir, focusWanted, folded, newFileDir, rovingPath, setTree } from "./tree-state.ts";

let pickFiles: HTMLInputElement | null = null; // the hidden file inputs
let pickFolder: HTMLInputElement | null = null;

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
