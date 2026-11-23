# Execution plan for the full-web-code audit

How the audit of `web/` is run: the items in order, who builds and reviews each, the pull requests, the gates, and
what is planned after it. The reasons are in `docs/web-audit-proposal.md` (the proposal); the evidence is in
`docs/archive/web-audit-surveys/` (the reports). This file does not repeat an item's content: an id such as `S2` is
defined in the proposal's section 3.

**Status (2026-11-16).** Phase 0 is merged into `audit/0-nets` and its end gate is green (`docs/web-audit-log.md`). Scope decided by the maintainer: proposal B, plus four redesigns moved in from C
(R7 through the design note, R5, the focus-target registry of R3, R1) and screenshots as a net for the view moves.
Section 2 lists the decisions; all are made.

## 1. Scope

| In | Items |
|---|---|
| Nets | N1 to N6; **N7 (new): screenshots for phase 2** |
| Design notes | S0 (now also decides R7's ownership); **R5 note**; **R1 note** |
| Bugs | B1 to B5 |
| Consistency | C1 to C4; **C5 (new): phone toast placement** |
| Moves | S1 to S6, S9; S7 and S8 **without their graphics halves**; S9 **without its staging half** |
| Redesigns moved in | **R7r**: what S0 leaves of R7, the split of `state.ts` by owner. **R5**, in place of S9's staging half. **R3r**: the focus-target registry, in place of S6's exported handles. **R1**, in place of the graphics halves of S7 and S8 |
| Sweeps | W1 to W7 |

Left for after the audit (section 8): R2, the DOM test harness of R3, R4, and the rest of R6.

About 53 builder items: the proposal's 42 for B, less 3 halves, plus 3 design notes that were not counted or are new,
N7, R5, R3r (counted as one more: the registry is larger than the handles it replaces), R7r, R1's 3 and C5, and three
from the naming survey: the `echoLines` pilot, 3.0 and the spacing pass. Scaled from
the proposal's guess for B, that is 13 to 21 million agent tokens. The proposal said 45 to 47 for this scope; that left
out the notes and N7.

## 2. Decisions

Numbers are the proposal's section 8. All are the maintainer's, 2026-11-16, unless marked open.

| # | Decision | Answer | Effect here |
|---|---|---|---|
| 2 | Delete the `DOFILE_EDITOR_BASE` mode | Yes | S9 deletes it |
| 3 | Two `imports.test.ts` rules | The cast count in `machine.ts` stays. The old-names blacklist is dropped | N1 keeps the first and deletes the second |
| 4 | The CSS rule on `data-engine^="other-tab"` | It goes | C1 replaces it with a class the view sets |
| 5 | Pull request grouping | One branch per session, true merges; `main` frozen for the duration | Section 5 |
| 6 | Fable for S0 | Yes; other uses asked one at a time, with the reason | S0 on Fable; the spawning session still asks |
| 7 | The engine gaps B2 and B3 inside the audit | Yes; the SPEC changes with the behaviour | Phase 1's engine lane |
| 8 | The phone toast arithmetic, once left out | In, as C5; the maintainer checks it on a real phone and is told when it can be tried | Phase 2, lane c |
| 9 | Which redesigns move into B | All four, and the screenshots | Section 1 |

## 3. Rules

The proposal's six rules for every brief (its section 5) stand. Added here:

7. **Start from the code of the day.** The reports read `main` at 145a557. Before a builder starts, its brief's findings
   are checked against the current `main`: a finding that is gone is dropped and recorded, not fixed.
   The check is a read-only `orchestrate:surveyor` (one per lane or group of items, the regions not overlapping); its
   report goes into the builders' briefs.
8. **One lane, one stack.** Items in a lane run in series. An item whose predecessor is not merged yet branches from the
   predecessor's branch and is rebased when it merges. No two open items in different lanes edit the same source or
   test file: where the tables cannot avoid it, the After column orders them. Exempt, with the later pull request
   rebasing: the shared docs (`web/CLAUDE.md`, `docs/test-map.md`, SPEC), which change with the code, and the import
   lines of a file whose import a module split moves.
9. **An e2e read that a move breaks becomes a named helper** in the e2e hook; it is not repointed at the signal's new
   place. (This is R6, done where B touches it.) The hook keeps one `state` object whatever happens to `state.ts`
   (S0 says how), so a move alone breaks no read: the rule is for a read whose meaning changed. Each lane keeps its
   helpers in a file of its own, which the hook imports.
10. **A view move changes no pixel.** From phase 2 on, every pull request that touches a `.tsx` or `.css` file runs N7
    against the baseline of its base commit. A difference is explained in the pull request or fixed.
11. **A design note is approved by the maintainer before its first item starts.** S0 before S1; the R5 note before R5;
    the R1 note before R1.
12. **Renames happen inside the restructure that owns the file, not before.** A rename is never in the same commit as a
    spacing change. Before a rename, grep `biome/architecture.grit` and `test/imports.test.ts`: they match identifiers by
    name. The rules are in `web/STYLE.md` (Naming, Spacing).

Agents: `orchestrate:builder` per item in its own worktree, then a fresh `orchestrate:reviewer` at the builder's tier or
above; at most five at once; 80 tool calls per agent; a failing check goes to `orchestrate:investigator`, a long log to
the Haiku log-watcher; read-only research that ends in a report (rule 7's re-checks, the census, a mapping or a count)
to an `orchestrate:surveyor`, not a general-purpose agent. Each phase is one orchestrator session, which asks the
maintainer to approve its own plan and spawns before it starts (an approval does not pass from one session to the next).

Models, by risk. "S/h + O" is a Sonnet builder at high effort with an Opus reviewer.

| Tier | Items |
|---|---|
| Fable, high | S0 (authorized; Opus, high if the session's yes is not given) |
| Opus, high | B1, B2, B3, S1, S2, S7, S8, the R1 note (a candidate for Fable: ask), R1 |
| S/h + O | N1, S3, S5, S6 with R3r, R7r, R5 |
| Sonnet, medium | N2 to N7, B4, B5, C1 to C5, S4, S9, W1 to W7, the R5 note, the Run gate, the N7 tightening |
| Haiku | doc sync, renames, `docs/test-map.md` edits |

N1's Opus reviewer has one job: to match each removed assertion to its replacement (the proposal's risk 3).

**The audit's log.** `docs/web-audit-log.md`, one section per phase, written in the phase's last pull request: what
merged, what rule 7 dropped, the flaky tests seen, and the records section 8 needs. An orchestrator's notes folder is
not a record: it is deleted when its session closes.

## 4. Phases

### Gate G0, before phase 0

On the current `main`, in one worktree: `npm run check`, `npm run lint:strict`, `npm test`, `npm run snapshot`,
`check-snapshot`, the build, and the full e2e on every browser project. Planning ran only the first three (the third at
65c5bd9: 368 of 373, 5 skipped for want of a snapshot). The result is the baseline every later gate is compared with;
failures and flaky tests found here go in the audit's log with the sighting, so that no item is blamed for them.

### Phase 0: nets and design notes (session 1)

| Lane | Item | After | Pull request |
|---|---|---|---|
| a | N1: architecture tests without text pins; its path table keyed by folder or layer, not by file, so that a later split adds no row | G0 | 0.1 |
| b | N2: `app.test.ts` split, one `resetState()` | G0 | 0.2 |
| c | N3: e2e hook typed, write helpers, fixtures, roles | G0 | 0.3 |
| c | N4: `poc.spec.ts` covered and deleted, `step2.spec.ts` renamed | N3 | 0.3 |
| c | N5: tooling under `tsc`, `.mjs` scripts to `.ts`, the two CI lists | N4, and N1 merged (both edit `site.test.ts`) | 0.4 |
| c | N6: a streamed-run test, the fixed sleeps replaced | N5 | 0.5 |
| c | N7: the screenshot run (below) | N6 | 0.6 |
| d | S0: the workspace design note (section 6) | G0 | 0.7 |
| e | The R5 note (section 6) | G0 | 0.8 |

**N7.** A Playwright run kept apart from `npm run e2e` and from CI, on desktop Chromium and the iPhone project. Apart
means a config of its own with a test folder outside `e2e/` (a spec inside `e2e/` would run in CI on all four projects),
an npm script of its own, and that config under `tsc`. It walks a fixed list of states (ready with the sample; several
tabs with one unsaved; each dialog; each menu open; the tree with a rename field and a draft row; a log with an error; a
results table; a `.dta` view; a graph and the full-size view; each banner; the phone's three views) and compares each
with a baseline folder that git ignores. One command takes the baseline from a given commit, one compares. The first
builds that commit in a worktree of its own on its own `E2E_PORT` (the e2e setup refuses a server that serves another
build). Animations off, fonts loaded before the first shot. The list is fixed here and checked again at phase 2's start
gate, since phase 1 adds a banner. Its builder reports how stable two baselines of one commit are; a state that will not
hold still is dropped from the list, not loosened.

**End gate.** All eight pull requests merged into the session's branch, G0's checks again on it, S0 and the R5 note read
by the maintainer. Then the branch goes to `main` (section 5); the same at the end of every later session.

### Phase 1: bugs and names (session 2)

Each bug starts with a failing test and is its own pull request.

| Lane | Item | After | Pull request |
|---|---|---|---|
| a, engine | B2: store failures are shown | phase 0 | 1.1 |
| a | B3: a Break before the worker takes the run is kept | B2 | 1.2 |
| a | B4: decide from kinds | B3, and C1 merged (both edit `states/words.ts`) | 1.3 |
| a | C4, then C2: the visitor's words, small helpers; registry types, the controller cycles | B4 (so after C1: they share `StatusBar.tsx`, `DownloadDialog.tsx`, `FileBar.tsx`) | 1.4 |
| b, views | C1: engine-state predicates stated once; the CSS rule on `data-engine` replaced by a class the run controls take from the predicate, with an e2e check that the toolbar keeps its size and the buttons are unseen in the other-tab states | phase 0 | 1.5 |
| b | B5: three small ones in views | C1, and B2 merged (both edit `LogView.tsx`) | 1.6 |

B3 checks `browser.py` first; a Python change needs a new wheel and snapshot, and ruff. Its builder records in the
audit's log, for R2: whether the three small edits close the gap, and the tests it added.

**End gate.** G0's checks, plus `check-pytest`, `check-numeric` and `uv run poe test tests` for the engine lane.

### Phase 2: moves (sessions 3 and 4)

**Start gate.** S0 approved (decision 2 settled 2026-11-17). N7 tightened (the row below). N7's list of states checked
against phase 1's changes, then its baseline taken from `main`.

| Lane | Item | After | Pull request |
|---|---|---|---|
| e | N7 tightening: deterministic Chromium flags for the screenshots; if two baselines still differ, a per-state allowance in place of one global 30 pixels; a report of near-misses (states with 1 to the allowance pixels changed). Done before the baseline is taken | phase 1 | 2.0 |
| a, engine | C3: the shared-buffer protocol in `lazy-part.ts` | start | 2.1 |
| a | S7, without graphics: per-start facts, the controller's wiring. It leaves `web/src/main.tsx` alone, or waits for S1, which edits it | C3, and S1 merged if it needs `main.tsx` | 2.1 |
| a | S8, without graphics: `/work` mirror, boot and loader, typed dispatch (three items in a chain; the boundary is below) | S7 | 2.2 |
| a | The R1 note | S8, and the condition below | 2.3 |
| a | R1: the lazy graphics part as one machine, with its Node harness (three items). It takes the `worker.ts` graphics names (`askedAt`, `at`, the 22-variable `let` chain) and those of `lazy-part.ts`. It leaves `state.ts` and `app/engine.ts` alone: a change it needs there follows R7r | the note approved | 2.3, 2.4 |
| b, files | S1: editor documents in a DOM-free controller that owns Save, and `tabs` and `activeTab` (three items: the records with the derived signals; Save and the file code's calls; the scroll snapshot). Edits `web/src/main.tsx`. The Doc's shape is settled (decision 2, 2026-11-17: `docs/design/workspace.md` section 2, with the Save rule of section 3; the spike's branch `spike/doc-shape` is kept locally for S1) | start | 2.5 |
| b | S2, first half: the generator turn design (below), one door for page writes, the order tests | S1 | 2.6 |
| b | B1: uploads and "Restore the sample" take a turn (failing test first). `store.write` takes an expectation (one transaction); `createEntry` passes "absent"; the re-ask words go into SPEC's "Name clash" row. An engine change: snapshot first | S2's first half | 2.7 |
| b | S2, second half: it opens with a commit of the `uploadNow` renames (`ClashNow` and its fields, `ClashAnswer.same`, `ask`, the dialog view, the module-level `now`); then `files/actions.ts` split three ways | B1 | 2.8 |
| b | S3: `FilesPane.tsx` split, `rename.ts` with Node tests; it takes the `endRename` and `endDraft` names in `FilesPane.tsx` | S2 | 2.9 |
| b | Run gate: Run, Run selection and the banner's Run are offered only for `.do` and `.ado` tabs, by a computed from the path. A typed `do x.txt` keeps Stata's behaviour | S1, and S5 merged (rule 8: both edit the run controls) | 2.17 |
| c, views | S4: output readers into `.ts`, one command bar, one variables table | start | 2.10 |
| c | `echoLines` in `app/log/align.ts`: its names, and the first use of `web/STYLE.md`'s Spacing rule (the pilot) | start, standalone | 2.18 |
| c | S5: `runText` (and its names), scroll-follow, `CommandLine.tsx`, state logic out of `App.tsx` | S1 (both edit `state.ts`) and S4 (its one command bar is also in `CommandLine.tsx`) | 2.11 |
| c | S6 with R3r: one roving-key hook, one modal trap, the focus-target registry, owner functions for the shared signals (not `activeTab`: S1 owns it), and `graphIndex` as a computed with `selectGraph(n)` | S3, S5, and S7 merged (both edit `app/engine.ts`) | 2.12 |
| c | R7r: `state.ts` split by owner, as S0 lays out; the e2e hook's `state` object unchanged | S6 | 2.13 |
| c | C5: phone toast placement. When it is merged into the session's branch and the preview is up, the orchestrator tells the maintainer, with the four cases to try on a real phone; the session's merge to `main` waits for that check | R7r | 2.16 |
| d, build | S9, without staging (its clauses are below) | start | 2.14 |
| d | R5: `public/` staged by one script, the config only reads it (its clauses are below) | S9; the R5 note is approved (2026-11-17, `docs/design/staging.md`: choices 1 to 5, choice 3 amended) | 2.15 |

**S9 and R5, clause by clause.** S9: `scripts/lib`; `vite.config.ts` split into plugin modules; every snapshot knob in
the manifest; `npm run commands` through a temp file; `wheel` stops deleting the release wheels in the root `dist/`; the
denied-commands list generated; `measure-startup` and `compare-pytest` moved, not folded away; and the
`DOFILE_EDITOR_BASE` mode deleted. R5: file staging out of the config into one script; `wheel` once per `e2e`; the two
CI file lists generated from one table (R5 changes those workflows anyway).

**S2's turn design** (the maintainer's, 2026-11-16). Turn bodies are plain generators (`function*`) over an `Io` of store
operations; `fileTurn` runs them, one `yield` per operation, with a timeout per operation. A body cannot await a dialog,
a timer or another turn: it has nothing to await. Save's turn returns its pending write wrapped, and the answer is applied
after the turn (S0, choice b). Fallback, if generators prove awkward on real code: an async thunk given a `Writer` token
(branded, expiring when the turn ends), a lint rule that no holder of a `Writer` calls `fileTurn`, and a timeout.
`files/turns.ts` carries an extended comment on the generator pattern. This is the maintainer's explicit exception to
`web/CLAUDE.md`'s rule of sparse comments: reviewers keep it. S2's first half builds this; its second half splits
`files/actions.ts` three ways.

**Where S8 ends and R1 begins.** The 22 variables of `worker.ts`'s graphics section include some that boot and the
dispatch use (`started`, `runs`, `snapshotBase`, `brotliWasm`). S8's brief lists which of the 22 its modules may take;
the rest stay where they are for R1. "The graphics section" is what the `main` of the day marks as such.

**The condition on R1.** R1 starts only when the lazy graphics part has stopped changing: no open pull request, and no
branch the maintainer names as live, touches `client.ts`'s graphics methods, `worker.ts`'s graphics section or
`lazy-part.ts`, and the maintainer says the idle-wait work (pull request 74 and what follows from it) is done. If that
is not so when lane a reaches it, the lane ends at S8, phase 2 closes without R1, and R1 heads section 8's list. The
graphics halves of S7 and S8 are not done in either case.

**Sessions.** Session 3 runs lane a to S8, lane b to B1, S4 and S9, and ends with the phase's end gate on what it
built. Session 4 runs the rest. Lane c is the long one: it
waits on lane b twice.

**End gate.** G0's checks on every browser project; the engine checks of phase 1; N7 against the phase's start baseline,
every difference accounted for.

### Phase 3: close (session 5)

A sweep that has to change a test or a shared doc logs the change for W5 or the doc sync; it does not make it.

W1 to W7 each take, in their region, the names that say the wrong thing (the naming survey's first table, outside R1's
files), units and bare literals (constants without a unit, functions returning seconds without saying so, unnamed
literals), and promise callbacks (one spelling). Renames follow rule 12.

| Item | After | Pull request |
|---|---|---|
| 3.0: the glossary's vocabulary applied across `web/` (touches `types.ts` and SPEC section 6); starts after the maintainer has chosen the words (`web/STYLE.md`, Glossary) | phase 2 | 3.0 |
| W1, W2: sweep of `src/engine/`, the Python files, controllers and state | 3.0 | 3.1 |
| W3, W4: sweep of the views and `src/stata/` | 3.0 | 3.2 |
| W6, W7: CSS deletions; scripts, config, site, sample, HTML | 3.0 | 3.3 |
| W5: sweep of `test/` and `e2e/`, with what the other sweeps logged for it; it takes the test helpers (one `until`, one encode and decode pair, distinct `settle` and `settled`) | 3.1 to 3.3 | 3.4 |
| Spacing pass: `web/STYLE.md`'s Spacing rule over `web/`, whitespace only; its blank-line commits and its comment-move commits are separate; the whitespace commits go in `.git-blame-ignore-revs`; the pull request is merged with a merge commit | 3.1 to 3.4 | 3.7 |
| Doc sync: `web/CLAUDE.md`, `web/README.md`, `docs/test-map.md`, SPEC sections 5, 6 and 8, `docs/web-engine-data-flow.md`; among them `web/CLAUDE.md`'s claim that every request gets a ticket (tickets are per worker start, 01-F7) | the sweeps and the spacing pass | 3.5 |
| Whole-diff review, G0 to head, by an Opus reviewer that has read none of the items; its report to `docs/archive/web-audit-surveys/` | 3.5 | 3.6 |
| The census again, by an `orchestrate:surveyor`, with `docs/archive/web-audit-surveys/census/`, against report 04; its report to the same folder | 3.5 | 3.6 |

**W1 and W2's type items** (the maintainer, 2026-11-22, after the engine-groups pull request). Besides the sweep, W1 and
W2 take each of these, with a change or a written reason to leave it. File names are as at `ed758bb`: re-check them after
phase 2 (S8's typed dispatch and R7r move these files).
- `EngineState` (`app/types.ts`) restates the machine's `State` without its tickets, kept in step by `SameTags`,
  `NothingHidden` and `view()`. The engine-groups review advised keeping it written out (its per-state comments, the
  `message` field, readable hovers and errors). The sweep brings the maintainer the choice with the cost of each side and
  changes nothing before that decision.
- The type utilities `Equal` and `Expect` (and the helpers of the machine's other type checks) live in `machine.ts`, and
  `app/types.ts` imports them from there. Give them a home of their own if that keeps the machine's type-only imports and
  adds no import cycle.
- The casts `as Record<Stage, string>` in `states/words.ts` and `as LogItem` in `run.ts`; and `as ComponentType<...>` in the
  registry `banners.tsx`, a view, so W3's region: W1 and W2 log it for W3 if they leave it.
- The per-state case lists of `startOffer` (`start.ts`) and `refusedRunWords` (`editor/words.ts`): kept, since they force a
  decision for each new state, as `WAKE_LOCK` does, unless a group of `machine.ts` says the same and that check stays.

**End gate.** Every check of every earlier gate, and `uv run poe lint` (W1 sweeps the three Python files). Then
`docs/phase2-plan.md` records the code audit (this plan) as done. Its audit section lists more than this plan covers,
and that stays open there: the design checks on the real pages, the accessibility items, the split of the main chunk,
the contrast check, the first deploy's checks. This file and the proposal stay where they are until section 8 is done.

### After phase 3: an independent audit (session 6)

`ponytail:ponytail-audit` over `web/`, run under the orchestrate skill, as a read that owes nothing to this plan. It
looks for other things than the plan did (bugs with a concrete case, data loss, what breaks under load, risky code
with no test, code that should not exist), reports at most 20 findings a run, and changes nothing.

How the two fit together:
- The orchestrator spawns one read-only agent per region (the seven sweep regions, or fewer). Each is a
  general-purpose agent, since the plugin's own agent types (the surveyor among them) cannot invoke a skill, and its
  brief carries the orchestrate rules such an agent needs.
- **A region agent is given the code and nothing else**: not the proposal, this plan, the reports or the audit's log.
  Told what was fixed, it would confirm it. It invokes the skill on its region, at the load "one visitor, one tab, the
  files in the browser", and writes the skill's report to a file.
- The orchestrator then does what the agents may not: drops what the audit's log shows as known or decided, merges
  duplicates across regions, ranks what is left, and checks each must-fix by reading the code.
- Models by region, as in section 3: Opus for the engine, storage and file-write regions, Sonnet for the rest.
- Output: `docs/archive/web-audit-surveys/`, one merged report. Its findings are section 8's first input.

## 5. Branches and pull requests

**One integration branch per session** (`audit/0-nets`, `audit/1-bugs`, `audit/2a-moves`, `audit/2b-moves`,
`audit/3-close`), cut from `main` when the session starts. Decided by the maintainer 2026-11-16, who also means to
freeze `main` for the duration.

- Each number in the phase tables is a pull request **into the session's branch**: 39 in all. The orchestrator merges
  it there once its reviewer accepts and its checks pass. "Merged" in an After column means merged there.
- **An item is merged with a merge commit too, never rebased or squashed.** The commits the reviewer read land with
  their hashes unchanged; one item is one merge, named by its id, and `git revert -m 1` takes it out whole; an item
  stacked on another needs no rebase when its base lands; and no agent rewrites history. `git log --first-parent` on
  the session's branch lists the items, and on `main` the five sessions.
- At the session's end gate the branch becomes **one pull request to `main`**, merged with a merge commit so that the
  items stay apart in the history. Five merges to `main`, each a deploy.
- Before that merge the maintainer looks at the branch's preview (`preview.yml` builds one for every pull request), on
  a real phone where the session touched views. This is the only check on a real device before production.
- If `main` moves all the same (the freeze is the maintainer's to keep or lift), it is merged into the branch before
  the gate.

Why not 39 pull requests to `main`, as the proposal first recommended:
- every merge to `main` deploys the live demo, and under the views the only net is an emulated phone;
- a lane no longer waits for the maintainer between items, so stacking and "X merged" cost nothing;
- a mistake found at the gate is fixed on the branch, before production;
- the maintainer reviews five times, with a preview, not 39 times.

Why not one branch for the whole audit:
- a freeze of `main` is easier to hold for a session than for the whole audit, and whatever lands meanwhile has to be
  ported onto moved code;
- the first deploy would carry every change at once: a regression seen in production then has 39 suspects;
- an audit that stalls leaves a branch nobody can merge. A session's branch is days old at most.

What it costs against 39 to `main`: bug fixes reach production at the session's end, not one by one; and a session's
merge is larger to read. CI already runs for a pull request into any branch (`web.yml`, `ci.yml` and `lint.yml` have no
branch filter).

## 6. The three design notes

Each is one page in `docs/design/`, written by one agent that changes no code, and approved by the maintainer.

**S0, the workspace.** Decides, for S1, S2, S3, S5, S6 and R7r:
- who owns the file list, the tabs, each open document, its saved text, and the order of writes (R7's question: one
  workspace owner, or the three controllers of the proposal);
- the unit of order. It may not be a queue per operation: an upload's clash dialog would hold every Save (report 03,
  section 5). One write and its follow-up per turn is the starting point;
- "dirty" as a derived value, and what replaces `tabs[].dirty`, `activeTab` against the Editor's `shown`, and
  `graphIndex`;
- the target module list, each module's exported functions, and which signal each owns (the layout R7r then applies to
  `state.ts`);
- what the views may still call, and the `editorCommands` contract;
- what the e2e hook exposes after the split. `main.tsx` hands the whole `state` module to the hook, and the specs read
  it 179 times in 12 files. The starting point: the hook keeps one `state` object, assembled from the owner modules, so
  that a split changes no e2e read (converting the reads is R6, which is not in this plan);
- the Node tests that must exist before each view loses its logic;
- room for one later feature, not built here: remembering the open tabs and the active tab across reloads
  (`docs/phase2-plan.md`, "Later UI work", item 8; the tab that holds the engine's lock keeps them). The owner of the
  tabs is where that state would be saved and restored.
It reads reports 03, 05 and 06, `web/CLAUDE.md`, and the files they name. It checks one assumption by trying it: that
`cm.ts`, or its state half, loads under Node.

**The R5 note.** Lists every reader and writer of a staged file (the wheel, extra wheels, Pyodide's files, the
snapshot): every npm script and every workflow, with `snapshot`, the `check-*` scripts, `preview`, `cf:dev`, `deploy`
and the `build-web` action among them, and N7's baseline command. For each, what must be staged and when. Then the two
CI lists, and how staleness is told afterwards. The deploy path comes first: a merge deploys. It answers report 10's
worry (the "one command" feel of `npm run dev`).

**The R1 note.** Written from the code of its day, not from the reports. The table of states and events on both threads
(the page's fetch and hand-over; the worker's wait, idle steps, native decode and own fetch); the 22 variables as one
record, and which of them S8 already moved; what stays a side effect; how a lazy part is driven through the real worker
under Node, or why it cannot be; and the limit S8 works under (iOS runs the worker twice: imported modules only, no
chunk of its own). It names the tests that pin today's behaviour before any line moves; among them
`e2e/graphics.spec.ts`, which reads the worker's `[dofile] graphics part` console lines and times the idle wait from
them.

## 7. Checks

- **Engine items** (B1 to B3, C3, S7, S8 and any item that edits `src/engine/`) run `npm run snapshot` first and then
  `npm test`, which expects 383 tests with a snapshot present (363 pass and 5 skip without one). CI's `unit` job has
  no snapshot; its `memory snapshot` job runs only when engine paths change.
- **Per item:** `npm run check`, `npm test`, the item's e2e specs on Chromium and the iPhone project with
  `SNAPSHOT_QUALITY=5` and its own `E2E_PORT`; from phase 2, N7.
- **Per phase:** the end gates above.
- **Stop rule:** two failed fix rounds on an item, or an item at twice its size, goes back to the maintainer.
- **Known limit:** the iPhone is emulated. The real-phone pass of `docs/phase2-plan.md` runs after the audit.

## 8. After the audit: planning the rest of C

These are planning tasks, not builds. Each ends in a section of one new file, `docs/web-audit-redesigns.md`. They run in
a session of their own (session 7), after the independent audit, on the code as the audit left it, and read the audit's
log and the two phase 3 reports in `docs/archive/web-audit-surveys/`.

| # | For | Task | Who | Output |
|---|---|---|---|---|
| 1 | all | Read the audit's log, phase 3's census, its whole-diff review and the independent audit for what the audit did not close. | orchestrator | the list the tasks below start from |
| 2 | R1, if it did not run | Check the condition on R1; if it holds, write the R1 note (section 6). | Opus, high | the note, and R1's three items scheduled |
| 3 | R2 | From B3's record in the audit's log: did the simple fix close the gap, and which tests pin it. Then design the ticket per run: where the ticket travels (the interrupt buffer's one word is Pyodide's; a second word, or a message; and the case with no shared buffer at all), what the machine issues and checks, which cells of SPEC section 5 and which tests in `machine.test.ts` change. | Opus, high | a design note; R2 as items with sizes; a recommendation to do it or drop it, since report 01 would do it only if B3 fell short |
| 4 | R3, the harness | A trial, not a design: two views that still hold behaviour after the audit (candidates: `Dialog`, the tree) tested under two candidate libraries. Record what each gets wrong about focus against the browsers, the dependency's size and licence, and how many of the remaining e2e-only behaviours a harness could cover. | Sonnet, high | a comparison and a yes or no; the dependency needs the maintainer's approval |
| 5 | R4 | Run `census/css.mjs` again. Map each block of `app.css` and `ui.css` to the components the audit left. Decide the layout (a sheet per component, or sections), how the phone breakpoint is stated once, and whether N7's uncommitted baselines are enough or baselines go in the repository. The phone toast arithmetic needs a real device: list it, do not plan it. | surveyor, Sonnet, high | a mapping table and R4 as items; it is scheduled with the later UI work, not before |
| 6 | R6 | Count the `state.*` reads left in `e2e/` after rule 9. Name the surface they need and group the reads by helper. | surveyor, Sonnet, medium | the surface as a typed list, and the conversion as one or two mechanical items |
| 7 | all | Order the results, size them, and write the execution plan for what the maintainer keeps. In the same change: replace the icebox entry, repoint `docs/phase2-plan.md`, and move this file and the proposal to `docs/archive/`. | orchestrator | `docs/web-audit-redesigns.md` |

Tasks 3 to 6 are independent and can run at once. About five agents and under a million tokens in all, by the measure
of the planning surveys.

## 9. Not verified

- A fresh-context reviewer (Opus) read this plan at 3c61fcf against the proposal, reports 01, 02, 03, 05 and 06 and the
  code, and found four must-fix and nine should-fix points
  (`docs/archive/web-audit-surveys/12-execution-plan-review.md`). All are applied here, with its nice-to-haves 1 to 7.
  The corrected text was checked only by the planner.
- This plan was written from the proposal and the reports. No item was started and no finding re-checked beyond the
  corrections the proposal lists.
- The lanes' file collisions were worked out from the reports' file lists and the reviewer's greps, not from a
  dependency graph. Not checked: whether B2 or B4 also edit `ResetDialog.tsx`, which C1 edits; whether S2's first half
  edits `state.ts` while S5 runs.
- N7 is a design on paper: nobody has measured how stable screenshots of this page are.
- The token figures are scaled guesses. The count of 39 pull requests assumes no item is split. The branch model of
  section 5 was not reviewed.
