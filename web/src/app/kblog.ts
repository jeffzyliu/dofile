// The keyboard experiment's overlay (?kblog; docs/phone-keyboard-experiment.md): a list over the top of the page of the
// events around a phone's on-screen keyboard, with times, so one sitting on a real iPhone shows the order Safari gives
// them in. main.tsx imports this module only with the flag, so without it none of this is in the page.
//
// One row per event: the time in ms since the tap that began the sequence (a touch with no text field focused), the
// event, then the visual viewport's offsetTop and height, window.scrollY, window.innerHeight, the layout viewport's
// height (<html>'s clientHeight) and .app's top on screen. `raf` rows are the frames in which one of those changed with
// no event (sampled for 1.5 s after each event), `focusin` adds the caret's bottom (`c…`) when there is a selection. The
// overlay takes no taps (pointer-events: none) and no focus; each row also goes to the console.

/** The overlay's element, for the e2e test. */
export const KBLOG_ID = "kblog";
/** How many rows the overlay keeps. */
export const KBLOG_ROWS = 28;
/** How long after an event the frames are sampled (ms). */
const SAMPLE_MS = 1500;

const isField = (el: Element | null) =>
  Boolean(el?.matches("input, textarea, [contenteditable]:not([contenteditable=false])"));

export function showKbLog(): void {
  const vv = globalThis.visualViewport;
  const root = document.documentElement;
  if (!vv || document.getElementById(KBLOG_ID)) return;
  const box = document.createElement("pre");
  box.id = KBLOG_ID;
  box.setAttribute("aria-hidden", "true");
  box.style.cssText =
    "position:fixed;left:0;right:0;top:0;margin:0;padding:2px 4px;z-index:2147483647;pointer-events:none;" +
    "font:10px/1.25 ui-monospace,Menlo,monospace;background:rgb(0 0 0/.78);color:#fff;white-space:pre;" +
    "overflow:hidden;max-height:50vh;user-select:none;-webkit-user-select:none";
  document.body.append(box);
  const version = navigator.userAgent.match(/OS [\d_]+|Version\/[\d.]+/g)?.join(" ") ?? navigator.userAgent;
  const head =
    `${version} kb=${root.dataset.kb ?? "top"}${"kbSlide" in root.dataset ? " slide" : ""}\n` +
    "   ms event         offTop  vvH scrlY innrH clntH appTop";
  const rows: string[] = [];
  let t0 = performance.now(),
    last = "",
    until = 0;
  const num = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "-").padStart(5);
  const snap = () =>
    [
      vv.offsetTop,
      vv.height,
      globalThis.scrollY,
      globalThis.innerHeight,
      root.clientHeight,
      document.querySelector(".app")?.getBoundingClientRect().top ?? Number.NaN,
    ]
      .map(num)
      .join(" ");
  const add = (what: string) => {
    last = snap();
    const row = `${num(performance.now() - t0)} ${what.padEnd(13).slice(0, 13)} ${last}`;
    rows.push(row);
    if (rows.length > KBLOG_ROWS) rows.shift();
    box.textContent = `${head}\n${rows.join("\n")}`;
    console.log("[kblog]", row);
  };
  const sample = () => {
    if (snap() !== last) add("raf");
    if (performance.now() < until) requestAnimationFrame(sample);
  };
  const watch = () => {
    const idle = performance.now() >= until;
    until = performance.now() + SAMPLE_MS;
    if (idle) requestAnimationFrame(sample);
  };
  const caret = () => {
    const sel = getSelection();
    return sel?.rangeCount ? ` c${sel.getRangeAt(0).getBoundingClientRect().bottom.toFixed(0)}` : "";
  };
  const opts = { capture: true, passive: true };
  addEventListener(
    "touchstart",
    (e) => {
      if (!isField(document.activeElement)) {
        t0 = performance.now(); // a new sequence
        rows.length = 0;
      }
      add(`touch y${e.touches[0]?.clientY.toFixed(0) ?? "?"}`);
      watch();
    },
    opts,
  );
  const on = (target: EventTarget, type: string, name: string, extra = () => "") =>
    target.addEventListener(
      type,
      () => {
        add(name + extra());
        watch();
      },
      opts,
    );
  on(document, "focusin", "focusin", caret);
  on(document, "focusout", "focusout");
  on(vv, "resize", "vv.resize");
  on(vv, "scroll", "vv.scroll");
  on(globalThis, "scroll", "w.scroll");
  on(globalThis, "resize", "w.resize");
  add("start");
}
