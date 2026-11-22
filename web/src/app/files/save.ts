/** Hand a file to the browser's download. `name` defaults to the File's own. */
export function saveAs(blob: Blob, name = (blob as File).name ?? "download") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
