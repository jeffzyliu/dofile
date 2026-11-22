// How the page writes a size. Three ways, each as its visitors saw it: the files' sizes in decimal units (the tree, a
// .dta file, the clash dialog), the engine's memory in binary units (Data), and a plain count of megabytes (a download).

/** A file's size as the tree shows it, in decimal units: "512 B", "41 KB", "1.2 MB", "3.4 GB". */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 999_500) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 999_500_000) return `${(bytes / 1e6).toFixed(bytes < 9_950_000 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** The engine's memory in binary units (1 KB is 1024 bytes): "6 KB", "1.2 MB". */
export function binarySize(n: number): string {
  const unit = (value: number, name: string) => `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))} ${name}`;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return unit(n / 1024, "KB");
  if (n < 1024 ** 3) return unit(n / 1024 ** 2, "MB");
  return unit(n / 1024 ** 3, "GB");
}

/** Megabytes (1,000,000 bytes) as a number with `digits` decimals; the caller writes the unit. */
export const megabytes = (bytes: number, digits: number): string => (bytes / 1e6).toFixed(digits);
