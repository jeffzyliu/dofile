// STEP 4c: a .dta file's tab (docs/design/SPEC.md, section 3.11; P/.dta). App.tsx shows <DtaView path> in the editor's
// place while the active tab is { kind: "dta" } (4a's files/open.js adds it); the editor stays mounted, hidden.
//  - Bar 1: "data/wages.dta · 500 obs · 3 vars · 8 KB". Bar 2: `use "data/wages.dta", clear`, "Load" (primary: run.js
//    runCommand(text); disabled unless the engine is `ready`, `none` or `declined`), "Copy" (aria-label "Copy the use
//    command").
//  - The variables table, from engine.js call("describe_file", { path }) (OQ-5), and "Read with `describe using`; the
//    data in memory is untouched until you press Load." With no engine: the two bars and no table.
// Keep what it loaded in a signal of this file or ask again on mount: it is unmounted when another tab is made active.
import { Placeholder } from "../ui/Icon";

export const DtaView = ({ path }: { path: string }) => (
  <Placeholder step="4c">{path}: the .dta tab, its two bars (Load, Copy) and the variables table.</Placeholder>
);
