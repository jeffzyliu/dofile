// A drop of files on the page, and the one way an upload starts from a drop or a picked file.
import { useEffect } from "preact/hooks";

import { dialog } from "../state/notices.ts";

import { store } from "../store.ts";

import { entriesOf, fromDrop } from "./intake.ts";
import { fail } from "./ops.ts";
import type { Incoming } from "./upload.ts";
import { upload } from "./upload.ts";

export function send(items: Promise<Incoming[]>) {
  upload(items).catch(fail("The upload", "The upload failed")); // in its place in the queue now, before its read ends
}

/** A drop of files anywhere on the page uploads them. The listeners are the window's, in the capture phase: a drag with
 *  files stops there, so nothing under them sees it (CodeMirror would paste a dropped file's text). A drop uploads
 *  nothing while a dialog is open or the store is blocked (the browser still does not open the file). With the list
 *  folded away or on another phone view the upload still happens, and the toast says so. */
export function useDrop(ref: { current: HTMLElement | null }) {
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
