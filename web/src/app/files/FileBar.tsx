// STEP 4a: the bars over an open .csv, .tsv or .log in the editor (docs/design/SPEC.md, section 3.11; P/.csv, P/.log).
// App.tsx places <FileBar /> above the editor in the Editor pane; it reads `tabs` and `activeTab` and draws nothing for
// other files (a .dta tab's bars are output/DtaView.tsx's).
//  - .csv, .tsv: Bar 1 "data/raw/survey.csv · 1,204 rows"; Bar 2 `import delimited "data/raw/survey.csv", clear`, "Import"
//    (run.ts runCommand(text); disabled unless the engine is `ready`, `none` or `declined`), "Copy" (aria-label "Copy the
//    import command"; toast "Copied").
//  - .log: "output/analysis.log · written by the last run" (when `fresh` has it), "Download" (files.ts saveAs).
export const FileBar = () => null;
