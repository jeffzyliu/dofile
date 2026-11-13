# The phone keyboard experiment

On an iPhone the editor page jumped when the on-screen keyboard opened, mostly after a tap in the bottom half of the
screen. This page is the record of three rounds with an iPhone that compared ways for the page to follow the keyboard,
with the order of the browser's events shown on screen. Nothing here can be tested without a real iPhone: the e2e iPhone
profile has no keyboard.

**Outcome (2026-11-12, iOS 27.0.1): round 3's `early` is the page's behavior, and the `?kb=` and `?slide` flags are
gone.** The command line takes a tap's focus itself with `preventScroll`, so Safari does not pan; elsewhere a pan is
scrolled straight back (one frame on screen, about 3 px seen), `.app` stays at the top with the height of the visible
area, and the editor's caret is scrolled above the keyboard through CodeMirror when the keyboard opens and again once it
has settled. The code: `web/src/app/viewport.ts`, `web/src/app/log/CommandLine.tsx` and `web/src/styles/app.css`. The
overlay stays behind `?kblog` (`web/src/app/kblog.ts`) for a later check on a new iOS. Every round ran with pinch zoom
off (the editor page's viewport meta), and `viewport.ts` does nothing while the page is zoomed: turning zoom back on (the
plan's decision 6) needs another sitting with `?kblog` that includes taps while zoomed in (`docs/icebox.md`, "Phone"). The flags and steps below are
those of the experiment, kept as its record; the modes they name no longer exist.

## What the sources say, and what is not known

- iOS does not resize the layout viewport for the keyboard. The keyboard covers its bottom part. Tapping a field that
  would end up under the keyboard makes Safari scroll ("pan") the visual viewport up to it, and that moves even
  `position: fixed` content (React Aria's `usePreventScroll` comments, https://github.com/adobe/react-spectrum).
- That scroll is done by the browser's UI process, in step with the keyboard animation, before WebKit's layout
  viewport is updated (WebKit commit 7d1ede9, bug 267440,
  https://github.com/WebKit/WebKit/commit/7d1ede9ccf3c675ca660d6fb0342240c4e760a7e). So the page learns of the pan only
  after it is on screen.
- WebKit fires one `visualViewport` `resize` at the start of the keyboard's opening, which takes about 200 ms (React
  Aria's `runAfterKeyboard`). iOS fires `visualViewport` `scroll` while it pans
  (https://github.com/disnet/skyreader/pull/523).
- The lower the field, the larger the pan (https://github.com/MLGalusha/letter-archive/issues/42). That fits "the
  bottom half": a caret in the top half stays visible, so there is no pan. The command line is always at the bottom.
- In the editor (CodeMirror 6.43) a low tap can mean three movements: Safari pans everything up; the page moves `.app`
  back down to the visible area; CodeMirror scrolls its text to the caret. CodeMirror's own code also notes that
  Safari 26 ignores `focus({preventScroll: true})`.
- iOS 26.0 sometimes left the page panned (by about 24 px) after the keyboard closed. Users report it fixed in 26.1
  (https://developer.apple.com/forums/thread/800125).
- `interactive-widget=resizes-content` would avoid all of this. Safari does not ship it yet: WebKit has it in its source
  (Bramus, September 2026), and Chrome and Firefox on Android do.

Not known, and settled by the overlay: whether the pan starts before or after `focusin`; whether it moves
`window.scrollY` or only the visual viewport's `offsetTop`; whether `innerHeight` shrinks; whether a script can scroll
the pan back; whether `pre` stops it; whether `focus({preventScroll: true})` stops it on today's iOS.

## The flags

Add them to the editor's address from `npm run dev` on the LAN, e.g. `http://<computer>:5173/app/?kb=pre&kblog`.

| Flag | What the page does while the keyboard is open |
|---|---|
| none, or `?kb=top` | Today's behavior: `.app` follows the visible area (`top` = the pan, height = the visible height). |
| `?kb=transform` | The same, but `.app` moves by a transform, which needs no new layout. |
| `?kb=height` | `.app` stays at the top; only its height follows (the idea from the React project). |
| `?kb=unpan` | As `height`, and the page scrolls back to the top whenever it is found panned. |
| `?kb=pre` | When a text field takes the focus, `.app` shrinks at once to the height the keyboard will leave (the last seen, else 55 %), and the editor's caret is moved above it, so Safari may find nothing to reveal. Then as `unpan`. |
| `?kb=focus` | The command line takes the focus itself, with `preventScroll`, instead of the browser's tap. Otherwise as `top`. |
| `?kb=caret` | Round 2. The command line as `focus`; everything else as `unpan`, and once the keyboard has settled (no viewport event for 0.3 s) the editor's caret is scrolled to just above it. |
| `?kb=early` | Round 2. As `caret`, and the caret is also scrolled above the keyboard at once, at the first `vv.resize`: in the editor that comes about 120 ms before Safari's pan, so Safari may find nothing to reveal. |
| `&slide` | Adds a 0.2 s slide to `.app`'s move (with any mode). |
| `&kblog` | Shows the event overlay. |

## Steps (about 30 minutes)

1. Note the iOS version (Settings › General › About); the overlay's first line shows Safari's.
2. Open a file of about 60 lines in the editor once, so the Editor view has text to tap.
3. For each mode, in this order: `top`, `transform`, `height`, `unpan`, `pre`, `focus`, then the best one with
   `&slide`. Always add `&kblog`. Reload the page with the new address each time.
   - a. Editor view: tap a line in the top third. Hide the keyboard (tap Done, or swipe down).
   - b. Editor view: tap a line in the bottom third. Hide the keyboard.
   - c. Log view: tap the command line, type `di 1`, press Go. Hide the keyboard.
   - Do each of a, b and c twice. Take a screenshot of the overlay after the second b and the second c.
4. For each try note: how many movements you see; whether the top bar ever leaves the screen; whether the command line
   ends right on the keyboard; whether the caret stays in sight; whether all comes back when the keyboard closes.

## Reading the overlay

In the experiment the overlay's first line also named the mode (`kb=…`); without the flags it shows only the versions.

One row per event. The rows start again at each tap made while no text field has the focus.

| Column | Meaning |
|---|---|
| `ms` | Time since that tap. |
| `event` | `touch y…` (the tap, and where), `focusin c…` (the caret's bottom, when there is one), `focusout`, `vv.resize`, `vv.scroll` (the visual viewport), `w.scroll`, `w.resize` (the window), and `raf`: a frame in which a value changed with no event. |
| `offTop` | The visual viewport's `offsetTop`: how far Safari has panned. |
| `vvH` | The visual viewport's height (the visible area above the keyboard). |
| `scrlY` | `window.scrollY`. |
| `innrH`, `clntH` | `window.innerHeight` and the layout viewport's height. |
| `appTop` | Where `.app`'s top is on screen. |

What to look for: whether `offTop` goes above 0 in a row before `focusin`; how many `vv.resize` rows there are, and
whether the first already has the final `vvH`; whether `scrlY` ever leaves 0; under `unpan` and `pre`, whether `offTop`
comes back to 0 (and how quickly), or stays 0 from the start under `pre`; under `focus`, whether `offTop` stays 0.

## Results, round 1 (iOS 27.0.1, Safari 27.0.1, November 2026)

The overlay's first line says `OS 18_7`: Safari froze that part of its user agent; `Version/27.0.1` is the real one. The
phone's layout viewport is 699 px high; the keyboard leaves 396 (it is 303 px).

What the tester saw. The tester found it hard to judge by eye and saw different things on repeated tries, so the
overlay logs below count for more than this table.

| Mode | a (top tap) movements | b (bottom tap) movements | c (command line) movements | Top bar left the screen? | Command line on the keyboard? | Back after closing? |
|---|---|---|---|---|---|---|
| top | no | moves up, the top bar jumps back; the opposite when the keyboard closes | same as b | yes | yes | yes |
| transform | no | yes | yes | yes | yes | yes |
| height | no | yes, the top bar does not come back | yes, the top bar does not come back | yes | no | yes |
| unpan | no | yes; the top bar sometimes goes, sometimes shrinks before it jumps back; the text does not scroll to the caret | yes | sometimes, only in b | yes | yes |
| pre | yes, the editor's text jumps far up | yes, sometimes not on the second tap | yes, sometimes not on the second tap | no | yes | yes |
| focus | — | yes, the text does not scroll to the caret | no | no | yes | yes |
| focus + slide | no | yes, the text does not scroll to the caret | yes | yes, briefly | yes | yes |

What the overlay logs show (12 screenshots: the second b and c of each mode, `height` excepted). They agree across
modes:

- **The pan comes after `focusin`, never before.** There is one `vv.resize` per opening, and it already has the final
  height (396).
- **The pan is a real window scroll:** `scrollY` equals `offsetTop`, and `innerHeight` shrinks by the pan (699 → 396
  for the command line); the layout viewport's height stays 699.
- **The pan is just enough to show the caret:** taps at y 458, 505, 538 and 563 pan by 82, 133, 158 and 184 (the
  caret's bottom plus about 18, less 396). The command line, at the bottom, always gets the full 303.
- **The order depends on the field.** On the command line (an input) the first `vv.resize` already has `offsetTop`
  303. In the editor (CodeMirror) the first `vv.resize` has `offsetTop` 0, and the pan follows about 120 ms later as a
  window scroll.
- **A script can undo the pan.** Under `unpan`, `scrollTo(0, 0)` puts `scrollY` back to 0 in the next frame, and
  `offsetTop` follows (11 ms on the command line, about 117 ms in the editor).
- **`focus({preventScroll: true})` works on iOS 27 for an input.** Under `focus`, `offsetTop` stays 0 for the whole
  command-line sequence, in both logs (with and without `slide`). No other mode gets that.
- **`pre` stopped the pan once** (an editor tap, caret at 500: `offsetTop` stayed 0) **but not on the command line**
  (a pan of 173 instead of 303).
- `w.scroll` rows whose `scrlY` does not change are element scrolls (the overlay listens on `window` with capture):
  the editor's or the log's own scrolling.

Three faults explain most of what the tester saw:

1. **At `focusin` the editor's caret is often still the previous one.** Compare the tap with the caret: 458 with c188,
   505 with c214, 538 with c214, 563 with c188. CodeMirror has not moved the selection yet. `pre` then scrolls the
   text for the old caret. That is why a top tap under `pre` made the text "jump far up", and why `pre` was erratic on
   second taps.
2. **When the keyboard closes, the "follow" modes (`top`, `transform`, and `focus` in the editor) leave `.app` too low
   for about 400 ms.** The window scrolls back to 0 (a `w.scroll`) about 400 ms before the `vv.resize`, and until then
   `offsetTop` keeps its old value. `.app`'s top stays at the pan: `appTop` +158, +82, +184. This is "the opposite
   when the keyboard closes". `unpan` keeps `--vv-top` at 0 and has no such gap (`appTop` 0 throughout).
3. **No mode scrolls the editor to the caret.** Safari's pan shows the caret, but every mode then undoes the pan
   (`top` by moving `.app` down, `unpan` by scrolling back). The caret is again under the keyboard, and nothing scrolls
   CodeMirror after its height has shrunk.

By mode:

- `height`: the top bar stays off the screen and the command line is not on the keyboard. Out.
- `transform`: the same numbers as `top`. The delay is in the events, not in the layout. Out.
- `slide`: the 0.2 s ease adds to the delay: the top bar stays out of sight longer, and on closing it comes after the
  400 ms gap. Out.
- `pre`: a stale caret (fault 1), and it does not stop the pan on the command line. Out as it is.
- Command line: **`focus`**, with no movement at all.
- Editor: `top` and `unpan` both put `.app` back one frame after the pan. `unpan` has no gap on closing (fault 2), so
  it is the simpler choice. Both need fault 3 fixed.

Proposed next step: a round 2 with the command line on `focus`, and the editor on `unpan` plus a scroll of the
caret into view (CodeMirror's `scrollIntoView`) when the area above the keyboard shrinks while the editor has the
focus. Possibly also an editor variant that does this at the first `vv.resize`, before Safari's pan about 120 ms later:
with the caret already in sight Safari may not pan at all.

## Round 2: `caret` and `early` (about 10 minutes)

Both modes put the command line on `focus` and the editor on `unpan`, and then scroll the editor's caret to just
above the keyboard (fault 3). They differ only in when they scroll. `caret` scrolls after the keyboard has settled, so
you see Safari's pan, the page going back, then the text scrolling. `early` scrolls at the keyboard's first resize,
before Safari pans. If Safari then finds the caret already in sight, there is no pan at all.

Steps, for `?kb=caret&kblog` and then `?kb=early&kblog` (reload with the new address each time):

- a. Editor view: tap a line in the top third. Hide the keyboard.
- b. Editor view: tap a line in the bottom third, then (b2), with the keyboard still open, tap another line low in
  the visible text. Then hide the keyboard.
- c. Log view: tap the command line, type `di 1`, press Go. Hide the keyboard.
- Do each twice. Take a screenshot of the overlay after the second b (once the keyboard is hidden: the b2 tap does not
  start a new list, so one screenshot holds b, b2 and the closing) and after the second c. If the list is too long and
  its first rows (`touch`, `focusin`) are gone, take one more screenshot of a b without b2.

For each try note: whether the top bar ever leaves the screen; whether the caret ends in sight just above the keyboard;
whether the text jumps more than once; whether all comes back when the keyboard closes.

What to look for in the overlay: under `early`, whether `offTop` stays 0 after a bottom tap (the early scroll stopped
the pan) or still goes to about 130–180 (Safari decided the pan before the scroll); under both, `offTop` 0 throughout c.

## Results, round 2 (iOS 27.0.1)

From the overlay logs (four screenshots: the second b with b2, and the second c, under each mode):

- **Command line, both modes: no pan.** `offTop` and `scrollY` stay 0 from the tap to the keyboard closing, and `.app`
  never moves. With round 1's two `focus` logs, that makes four out of four. The keyboard left 369 px here, not 396
  (a taller keyboard, probably with its suggestion bar); the page followed it.
- **Editor, both modes: the pan comes in the first `vv.resize`** (`offTop` 138 and 189 at about 200 ms). In round 1
  the editor's first `vv.resize` had `offTop` 0 and the pan came about 120 ms later. So that order is not reliable,
  and `early` cannot get in before the pan. Under both modes the page scrolls back in the same event (`scrollY` 0 by
  the next row, 2–3 ms later), and `offTop` reaches 0 about 100 ms later.
- **The caret scroll ran as designed**, seen as element scrolls (`w.scroll` with `scrollY` 0). Under `early`, a second
  `w.scroll` comes at 210 ms with the page's scroll-back, so there is one movement. Under `caret` it comes at 602 ms,
  0.3 s after the last viewport event, as a second, separate movement.
- **b2**, a tap on another line with the keyboard open, gives no event at all: no pan, nothing to undo.
- The caret at `focusin` was stale again (a tap at y 514 read c168, y 574 read c142). Both modes read the caret only
  at the `vv.resize` or later, so this does not matter to them.

By the logs, `early` is the better of the two: it puts the scroll-back and the caret scroll in the same frame. A
script cannot stop the editor's pan on iOS 27. It is on screen for about one frame (`appTop` −138 or −189 in the
`vv.resize` row, 0 in the next).

What the tester saw:

| | Caret above the keyboard? | Top bar off the screen? | Movements |
|---|---|---|---|
| `early` | yes, except for taps near the end of the file | about 3 px, then it jumps back down | one |
| `caret` | almost always, except in a zone that could not be reproduced reliably | about 3 px, then back down | two: the page, then the editor's text |

**Both failures were one bug: an empty line.** The caret's place was read from the DOM selection's box, and a caret on
an empty line has no box (its bottom reads 0), so nothing was scrolled. The sample file ends with a line break, so its
last line is empty too: hence "near the end of the file". An e2e test confirmed it: with that code, a caret on an empty
line or on the last line stayed at y 774 behind a 400 px keyboard in every browser. Now the page asks CodeMirror
(`EditorView.scrollIntoView` on the main selection, `nearest`, a 24 px margin), which knows where the caret is on any
line and scrolls in its next frame, after the page's own scroll-back. On the file's last lines the editor is already
scrolled to its end, so the caret sits at the editor's foot, a few px above the keyboard, not 24.

## Round 3: `early` with the fix (about 5 minutes)

Only `?kb=early&kblog` (and `?kb=caret&kblog` to compare if `early` is not clearly right). Tap the editor in the bottom
third, on a line of text, on an empty line, and below the last line; tap the command line. Note whether the caret ends
in sight above the keyboard each time. If it does, `early` becomes the default and the other modes go.

## Results, round 3 (iOS 27.0.1)

With the caret revealed through CodeMirror, the tester found `early` good. It became the page's behavior and the flags
went (see the outcome at the top).
