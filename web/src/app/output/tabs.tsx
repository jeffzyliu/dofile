// The Output tabs (docs/design/SPEC.md, sections 3.7 to 3.9). App.tsx places each in the Output pane (desktop, split) or
// in the Log pane (unsplit), and in its PhoneOutputViews, the phone's Data and Results views, inside the role="tabpanel"
// it draws itself. They may be unmounted and mounted again when the layout changes, so their state is in signals
// (state.ts: graphs, graphIndex, graphFull, data, rows, pickedVar, results, macros; view.ts: the filter text, the
// folds, the open matrices, the cells shown whole). One file for each tab:
//  - GraphTab.tsx: the latest graph, thumbnails, Open full size, Export PNG; output/FullSize.tsx draws the full view.
//    The phone has no Graph tab: graphs show inline in its log (4b), and a tap opens the full-size view.
//  - DataTab.tsx: facts, Filter variables, the variables, Browse. Never writes `rows`, never calls `browse`.
//  - ResultsTab.tsx: e(), r(), locals and globals; the matrix view (call("matrix")).
//  - format.ts: the logic with no DOM (number formatting, sections, cut cells, alt text), tested in Node.
export { DataTab } from "./DataTab";
export { GraphTab } from "./GraphTab";
export { ResultsTab } from "./ResultsTab";
