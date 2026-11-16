// The tab lock and persistent storage.

export const LOCK = "dofile-engine";

/**
 * One tab owns the engine and the files: it holds the Web Lock "dofile-engine" until it closes or another tab takes over.
 * @param onLost - called when another tab took the lock.
 * @returns `take()` resolves true when this tab owns the lock, false when another does. `take({ steal: true })` always
 * resolves true, and the other tab's onLost runs. Without Web Locks (a page that is not a secure context, such as
 * plain HTTP on a LAN), or when the browser refuses the request, there is nothing to hold and take() is true.
 */
export function tabLock({
  locks = globalThis.navigator?.locks,
  name = LOCK,
  onLost = () => {},
}: {
  locks?: Pick<LockManager, "request"> | null;
  name?: string;
  onLost?: (e: unknown) => void;
} = {}) {
  const take = ({ steal = false } = {}) =>
    new Promise<boolean>((ok) => {
      if (!locks) return ok(true);
      let held = false;
      const refused = (e: any) => {
        console.warn(`[dofile] no tab lock: ${e?.message ?? e}`);
        ok(true);
      };
      try {
        locks
          .request(name, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
            if (!lock) return ok(false);
            held = true;
            ok(true);
            return new Promise(() => {}); // never released by this tab
          })
          .catch((e) => (held ? onLost(e) : refused(e))); // a stolen lock rejects the holder's request with AbortError
      } catch (e) {
        refused(e);
      }
    });
  return { take };
}

const asked = new WeakSet();
/**
 * Ask the browser, once, to keep the files. The browser may show its own prompt (Firefox does) and answer much later,
 * or never, so `onAnswer` is called twice: at once with what persisted() says now, and again when persist() has been
 * answered. Never rejects; a persisted() that fails answers null.
 * @param onAnswer - true, false, or null when the browser has no such API.
 * @returns the first answer.
 */
export async function keepFiles(
  storage: Pick<StorageManager, "persist" | "persisted"> | null | undefined = globalThis.navigator?.storage,
  onAnswer: (kept: boolean | null) => void = () => {},
): Promise<boolean | null> {
  if (!storage?.persist) {
    onAnswer(null);
    return null;
  }
  const state = () =>
    Promise.resolve()
      .then(() => storage.persisted())
      .then(Boolean, () => null); // an error: not known
  const now = await state();
  onAnswer(now);
  if (!asked.has(storage)) {
    asked.add(storage);
    Promise.resolve()
      .then(() => storage.persist())
      .catch(() => {
        /* refused: persisted() says so */
      })
      .then(state)
      .then(onAnswer, () => {});
  }
  return now;
}
