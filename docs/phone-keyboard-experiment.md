# The phone keyboard experiment

On an iPhone the editor page jumps when the on-screen keyboard opens, mostly after a tap in the bottom half of the
screen. This page is for one sitting with the phone. It compares six ways for the page to follow the keyboard and
records the order of the browser's events on screen. Nothing here can be tested without a real iPhone: the e2e iPhone
profile has no keyboard. The code is `web/src/app/viewport.ts` (the strategies), `web/src/app/kblog.ts` (the overlay)
and `web/src/styles/app.css`. Without the flags the page behaves as before.

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

## Results to fill in

| Mode | a (top tap) movements | b (bottom tap) movements | c (command line) movements | Top bar left the screen? | Command line on the keyboard? | Back after closing? |
|---|---|---|---|---|---|---|
| top | | | | | | |
| transform | | | | | | |
| height | | | | | | |
| unpan | | | | | | |
| pre | | | | | | |
| focus | — | — | | | | |
| best + slide | | | | | | |

Send back the table, the iOS version and the screenshots. The result decides the default (`?kb=` goes; one strategy
stays).
