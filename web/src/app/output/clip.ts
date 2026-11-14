// What the Output tabs do with the clipboard and with a graph's PNG: copy text, copy an image, hand the PNG to the
// browser's download (or, on a phone, to the share sheet). Each says so with a toast. The graph's PNG is base64 text.

import { saveAs } from "../files.ts";
import { isPhone, showToast } from "../state.ts";
import type { Graph } from "../types.ts";

/** Copy `text`. The clipboard API where the page may use it, else the old way through a hidden field. A toast says
 *  "Copied", or that the browser refused. Resolves whether it was copied. */
export async function copyText(text: string, done = "Copied"): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = fallbackCopy(text);
  }
  showToast(ok ? done : "Couldn't copy: the browser refused", ok ? undefined : "error");
  return ok;
}

function fallbackCopy(text: string): boolean {
  const field = Object.assign(document.createElement("textarea"), { value: text });
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.opacity = "0";
  // the focus comes back only to keyboard focus: after a click, focus() would bring it back as keyboard focus, ring and
  // all (the browser's :focus-visible heuristic), so a click's focus is left off
  const active = document.activeElement;
  const keep = active instanceof HTMLElement && active.matches(":focus-visible") ? active : null;
  document.body.append(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  keep?.focus();
  return ok;
}

/** The PNG's bytes from base64. */
export function pngBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A graph's file name: its .png's own name, else "graph-3.png". */
export const pngName = (g: Graph) =>
  (g.from === "file" && g.path ? (g.path.split("/").pop() ?? "") : "") || `graph-${g.n}.png`;

/** Whether this browser can put an image on the clipboard (Firefox before 127 cannot): "Copy image" is off without it. */
export const canCopyImage = () => typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

/** Copy the graph as an image. Resolves whether it was copied; a toast says so. */
export async function copyImage(g: Graph): Promise<boolean> {
  try {
    const png = new Blob([pngBytes(g.png)], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    showToast("Copied");
    return true;
  } catch {
    showToast("Couldn't copy the image: the browser refused", "error");
    return false;
  }
}

/** Export PNG: the file goes to the browser's download; on a phone that can share files, to the share sheet. */
export async function exportPng(g: Graph): Promise<void> {
  const file = new File([pngBytes(g.png)], pngName(g), { type: "image/png" });
  if (isPhone.value && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // the visitor closed the sheet
    }
  }
  saveAs(file);
}
