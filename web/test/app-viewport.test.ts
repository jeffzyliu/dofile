// watchViewport (src/app/viewport.ts) on a stand-in page.

import assert from "node:assert/strict";
import { test } from "node:test";

import { KEYBOARD, SETTLE, useWiring, watchViewport } from "./wiring.ts";

useWiring();

test("the phone keyboard: watchViewport sets data-keyboard and --vv-height while the visual viewport is clearly shorter, not when zoomed or off the phone", () => {
  // a visualViewport as iOS Safari reports it: the layout viewport stays 844 px tall when the keyboard opens
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = {
    dataset: {} as DOMStringMap,
    style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
  };
  let phone = true;
  const { update, stop } = watchViewport({
    vv: vv as VisualViewport,
    root: root as unknown as HTMLElement,
    layoutHeight: () => 844,
    enabled: () => phone,
    later: () => {}, // the caret's timers: keyboardPage, below
  });
  const move = (height: number, offsetTop = 0, scale = 1) => {
    Object.assign(vv, { height, offsetTop, scale });
    vv.dispatchEvent(new Event("resize"));
  };
  assert.equal("keyboard" in root.dataset, false, "closed at the start");
  assert.equal(vars.size, 0);

  move(844 - KEYBOARD + 10); // Safari's toolbars, not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508); // the keyboard opens
  assert.equal("keyboard" in root.dataset, true);
  assert.deepEqual([...vars], [["--vv-height", "508px"]]);
  move(844); // closed again: nothing set
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  move(422, 200, 2); // a pinch to 2x: smaller, but no keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508);
  phone = false;
  update(); // the layout is no longer the phone's
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  stop();
  phone = true;
  move(508); // no longer listening
  assert.equal("keyboard" in root.dataset, false);
  assert.deepEqual(
    watchViewport({ vv: null, root: root as unknown as HTMLElement }).update(),
    undefined,
    "no visualViewport: nothing to do",
  );
});

test("the phone keyboard where the browser shrinks the layout viewport: open while a text field has the focus and the page is well below its tallest at this width; not on a rotation or without focus", () => {
  // an older Android browser: the layout and visual viewports shrink together, so they never differ
  let h = 800;
  let w = 390;
  let focused = false;
  const vv = Object.assign(new EventTarget(), { height: h, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = {
    dataset: {} as DOMStringMap,
    style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
  };
  const { stop } = watchViewport({
    vv: vv as VisualViewport,
    root: root as unknown as HTMLElement,
    layoutHeight: () => h,
    layoutWidth: () => w,
    typing: () => focused,
    later: () => {},
  });
  const resize = (height: number, width = w) => {
    h = height;
    w = width;
    vv.height = height;
    vv.dispatchEvent(new Event("resize"));
  };

  focused = true;
  resize(800 - KEYBOARD + 10); // the toolbar hides or shows: not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  resize(450); // the keyboard opens with a field focused
  assert.equal("keyboard" in root.dataset, true);
  assert.equal(vars.get("--vv-height"), "450px");
  resize(800); // closed
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  focused = false;
  resize(450); // shorter, but nothing takes typing (a split screen, say)
  assert.equal("keyboard" in root.dataset, false);
  focused = true;
  resize(390, 800); // a rotation to landscape: a new width starts again from this height
  assert.equal("keyboard" in root.dataset, false);
  resize(390 - KEYBOARD - 50, 800); // then the keyboard in landscape
  assert.equal("keyboard" in root.dataset, true);
  stop();
});

/** A watched page: a visualViewport as iOS Safari reports it (the layout viewport stays 844 px tall), timers run by
 *  hand, and the calls to scroll the page back and to reveal the editor's caret, counted. */
function keyboardPage({
  phone = true,
  touch,
  selected,
}: {
  phone?: boolean;
  touch?: EventTarget;
  selected?: Set<unknown>;
} = {}) {
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = Object.assign(new EventTarget(), {
    dataset: {} as DOMStringMap,
    style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
  });
  let clock = 0;
  let scrolled = false;
  const timers: { at: number; fn: () => void }[] = [];
  const seen = { phone, unpans: 0, reveals: 0, selected }; // what the page's callbacks read and count
  return {
    vars,
    seen,
    open: () => "keyboard" in root.dataset,
    move(height: number, offsetTop = 0, scale = 1) {
      Object.assign(vv, { height, offsetTop, scale });
      vv.dispatchEvent(new Event("resize"));
    },
    /** the page scrolls with no event the watcher hears (a field's scrollIntoView as the keyboard goes) */
    scrollPage() {
      scrolled = true;
    },
    pan(offsetTop: number, scrollY = false) {
      vv.offsetTop = offsetTop;
      scrolled = scrollY;
      vv.dispatchEvent(new Event("scroll"));
    },
    /** move the clock on by `ms` and run the timers due */
    tick(ms = 0) {
      clock += ms;
      for (const t of timers.splice(0).sort((a, b) => a.at - b.at))
        if (t.at <= clock) t.fn();
        else timers.push(t);
    },
    ...watchViewport({
      vv: vv as VisualViewport,
      root: root as unknown as HTMLElement,
      layoutHeight: () => 844,
      layoutWidth: () => 390,
      enabled: () => seen.phone,
      scrollTop: () => {
        seen.unpans++;
        vv.offsetTop = 0;
        scrolled = false;
      },
      panned: () => scrolled,
      later: (fn, ms = 0) => timers.push({ at: clock + ms, fn }),
      reveal: () => seen.reveals++,
      touch,
      // the elements of the drag guard's test: `room` lists the directions an element can scroll
      canScroll: (el, dx, dy) => {
        const room = (el as unknown as { room?: number[] }).room;
        return Boolean(room?.includes(Math.abs(dy) >= Math.abs(dx) ? Math.sign(dy) : 0));
      },
      onSelection: (t) => Boolean(seen.selected?.has(t)),
    }),
  };
}

test("the phone keyboard: Safari's pan is scrolled back while the keyboard is open and the page is panned, not otherwise; .app keeps its top", () => {
  const p = keyboardPage();
  p.pan(0, true); // no keyboard: a scroll is left alone
  assert.equal(p.seen.unpans, 0);
  p.pan(0);
  p.move(508); // the keyboard, no pan
  assert.equal(p.seen.unpans, 0);
  assert.deepEqual([...p.vars], [["--vv-height", "508px"]]);
  p.pan(120); // Safari pans the visible area to the field
  assert.equal(p.seen.unpans, 1);
  p.pan(0, true); // the page itself scrolled
  assert.equal(p.seen.unpans, 2);
  p.move(844);
  p.move(508, 189); // the pan in the keyboard's first resize (as on iOS 27): scrolled back at once
  assert.equal(p.seen.unpans, 3);
  p.move(422, 200, 2); // a pinch: no keyboard, nothing set, nothing scrolled
  assert.equal(p.open(), false);
  assert.equal(p.seen.unpans, 3);
  p.seen.phone = false;
  p.move(508, 120);
  assert.equal(p.seen.unpans, 3, "off the phone");
  p.stop();
});

test("the phone keyboard: a scroll of the page that no update has seen is scrolled back when the keyboard closes, so .app is not left short", () => {
  const p = keyboardPage();
  p.move(508);
  p.tick(); // the first update's own reveal
  assert.equal(p.seen.unpans, 0);
  p.scrollPage(); // a quick tap away: the field's scrollIntoView moved the page after the last update
  p.move(844); // the keyboard closes
  assert.equal(p.open(), false);
  assert.equal(p.seen.unpans, 1, "scrolled back at the close");
  p.move(844);
  assert.equal(p.seen.unpans, 1, "a page that is not panned is left alone");
  p.stop();
});

test("the phone keyboard: the drag guard cancels a touchmove that no scroller under the finger can follow, only while the keyboard is open", () => {
  // elements as a chain of parents; `room` says which of them can scroll towards the end (+1), the start (-1), or
  // neither
  const page = { parentElement: null as unknown };
  const bar = { parentElement: page };
  const pane = { parentElement: page, room: [-1, 1] };
  const top = { parentElement: page, room: [1] }; // at its start: it can only go on
  const line = { parentElement: pane }; // a touch on something inside a scroller: the walk up finds it
  const dead = { parentElement: bar };
  const touch = new EventTarget();
  const selected = new Set<unknown>();
  const p = keyboardPage({ touch, selected });
  // a touchstart at (x0, y0), then a touchmove to (x1, y1) with `touches` fingers; whether the touchmove was cancelled
  const drag = (target: unknown, [x0, y0, x1, y1]: number[], touches = 1) => {
    const send = (type: string, x: number, y: number) => {
      const e = new Event(type, { cancelable: true });
      const list = Array.from({ length: touches }, () => ({ clientX: x, clientY: y }));
      Object.defineProperties(e, { target: { value: target }, touches: { value: list } });
      touch.dispatchEvent(e);
      return e;
    };
    send("touchstart", x0, y0);
    return send("touchmove", x1, y1).defaultPrevented;
  };
  const up = [100, 300, 100, 250]; // the finger moves up: dy > 0
  const down = [100, 250, 100, 300];
  const across = [200, 300, 150, 295]; // left, a little up: dx > 0

  assert.equal(drag(bar, up), false, "no keyboard: left alone");
  p.move(508);
  assert.equal(drag(bar, up), true, "a bar cannot scroll");
  assert.equal(drag(page, down), true, "nor the page");
  assert.equal(drag(pane, up), false, "a pane with room towards its end");
  assert.equal(drag(pane, down), false, "and towards its start");
  assert.equal(drag(top, up), false);
  assert.equal(drag(top, down), true, "a pane at its start, dragged further");
  assert.equal(drag(line, up), false, "a child of a pane with room: the walk up finds the pane");
  assert.equal(drag(dead, up), true, "a child of a bar");
  assert.equal(drag({ parentElement: top }, down), true, "a child of a pane at its start, dragged further");
  assert.equal(drag(pane, across), true, "a pane that scrolls up and down, dragged sideways");
  assert.equal(drag(bar, up, 2), false, "a pinch (two touches)");
  selected.add(bar);
  assert.equal(drag(bar, up), false, "selected text (a selection handle)");
  selected.delete(bar);
  p.move(844); // closed
  assert.equal(drag(bar, up), false, "no longer guarded");
  p.move(508);
  assert.equal(drag(bar, up), true, "guarded again");
  p.stop();
  assert.equal(drag(bar, up), false, "stopped");
});

test("the phone keyboard: the editor's caret is revealed at once when the keyboard opens and again once it has settled, not after it closes", () => {
  const p = keyboardPage();
  p.move(508); // the keyboard opens
  assert.equal(p.seen.reveals, 1, "at the first resize");
  p.tick(SETTLE - 10);
  p.pan(120); // Safari's pan: scrolled back; the settle timer starts again
  assert.equal(p.seen.unpans, 1);
  p.tick(SETTLE - 1);
  assert.equal(p.seen.reveals, 1, "not settled yet");
  p.tick(1);
  assert.equal(p.seen.reveals, 2, "settled");
  p.pan(0); // a later event while open reveals again once settled, but not at once: the keyboard was already open
  assert.equal(p.seen.reveals, 2);
  p.tick(SETTLE);
  assert.equal(p.seen.reveals, 3);
  p.move(844); // closed: a pending timer reveals nothing
  p.move(508);
  p.move(844);
  const before = p.seen.reveals;
  p.tick(SETTLE);
  assert.equal(p.seen.reveals, before, "no reveal after the keyboard closed");
  assert.equal(p.vars.size, 0);
  p.stop();
});
