// STEP 4c: the Output tabs (docs/design/SPEC.md, sections 3.7 to 3.9). App.tsx places each in the Output pane (desktop,
// split) or in the Log pane (unsplit), and in its PhoneOutputViews, the phone's Data and Results views, inside a
// role="tabpanel" it draws itself; these fill it. They may be unmounted and mounted again when the layout changes: keep their state in signals (`graphIndex`,
// `pickedVar`, `rows`), not in component state.
//  - GraphTab: `graphs`, `graphIndex`; "Open full size" sets `graphFull` (output/FullSize.tsx draws that view; App.tsx
//    places it); empty state S 16. `graphs` keeps the last 20, so an index moves: find a graph by its `n`. The phone has
//    no Graph tab: graphs show inline in its log (4b), and a tap opens the full-size view.
//  - DataTab: `data`, `rows`, `pickedVar`; "Show 50 more" through engine.js call("browse", ...) appends to `rows`; empty
//    state S 17 ("The engine was reset, so no data is in memory" while `banners` has a reset).
//  - ResultsTab: `results`, `macros`; View a matrix with call("matrix", { name }); empty state S 18.
import { Placeholder } from "../ui/Icon";

export const GraphTab = () => <Placeholder step="4c">The Graph tab: the latest graph, thumbnails, Open full size, Export PNG.</Placeholder>;
export const DataTab = () => <Placeholder step="4c">The Data tab: facts, Filter variables, the variables table, Browse.</Placeholder>;
export const ResultsTab = () => <Placeholder step="4c">The Results tab: e(), r(), locals and globals; the matrix view.</Placeholder>;
