// STEP 4c: the full-size graph view (docs/design/SPEC.md, section 3.7; P/Full size, WP 6), over the whole editor page.
// App.tsx places <FullSize /> once, for every width (the phone has no Graph tab). It is open while state.js `graphFull`
// is true and shows graphs[graphIndex]; who opens it: the Graph tab's "Open full size" (4c), a tap on an inline graph in
// the phone's log (4b), a .png opened on the phone (4a's openFile). Close (Esc) sets `graphFull` false and gives the focus
// back. "graph 1 of 2 · scatter wage educ", "Export PNG", "Copy image", "Close", the strip of the session's graphs, ← →.
export const FullSize = () => null;
