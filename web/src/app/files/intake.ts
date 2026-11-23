// The files of a file input or a drop, read into the items an upload takes (upload.ts). The browser's File and entry
// APIs only: no store, no tabs.
import { joinPath } from "./tree.ts";
import type { Incoming } from "./upload.ts";

/** The files of a file input (`webkitRelativePath` keeps a folder upload's folders) put under the folder `dir`. */
export async function fromFileList(list: Iterable<File>, dir = ""): Promise<Incoming[]> {
  return Promise.all(
    [...list].map(async (f) => ({
      path: joinPath(dir, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
      data: new Uint8Array(await f.arrayBuffer()),
    })),
  );
}

// the browser's entry API for a drop (FileSystemEntry), the parts used here
interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, no: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (es: Entry[]) => void, no: (e: unknown) => void): void };
}

/** The files of a drop, folders walked, paths kept. Call `entriesOf` inside the drop handler, before any await: the
 *  items are gone after it. */
export function entriesOf(dt: DataTransfer): (Entry | File)[] {
  const out: (Entry | File)[] = [];
  for (const item of dt.items ?? []) {
    if (item.kind !== "file") continue;
    // a folder is walked through its entry; a file is taken as it is (a made-up drop's entry gives no file in WebKit)
    const entry = (item as DataTransferItem & { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.();
    const file = entry?.isDirectory ? null : item.getAsFile();
    if (file) out.push(file);
    else if (entry) out.push(entry);
  }
  if (!out.length) out.push(...(dt.files ?? []));
  return out;
}

export async function fromDrop(entries: (Entry | File)[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  const walk = async (e: Entry, dir: string): Promise<void> => {
    const path = joinPath(dir, e.name);
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, no) => e.file!(ok, no));
      out.push({ path, data: new Uint8Array(await f.arrayBuffer()) });
    } else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, no) => reader.readEntries(ok, no)); // at most 100 at a time
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const e of entries) {
    if (e instanceof File) out.push(...(await fromFileList([e])));
    else await walk(e, "");
  }
  return out;
}
