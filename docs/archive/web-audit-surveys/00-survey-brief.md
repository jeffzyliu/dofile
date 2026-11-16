# Common brief: survey for the web-audit plan (read this first, fully)

## What this is
The maintainer wants a total-code audit of `web/` (the dofile web demo: Pyodide engine in a Web Worker, Preact page) to
"get rid of the spaghetti": cut chaff, refactor for modularity and consistency, rework fragile code that does not make
sense. Focus: hard code quality, correctness, maintainability. NOT accessibility, design checks, deploy, security headers.
A redesign is on the table where it would make future maintenance substantially easier, but cost matters.

**You are not doing the audit.** You survey ONE region so an orchestrator can plan and size the audit. Your product is one
report file. Read as the future owner of this code: what would you be afraid to change, and why?

## Where
- Code to read: the worktree `<worktree>` (a worktree of the repository) (detached at origin/main
  145a557). Use absolute paths. Do NOT read the main checkout's `web/` (a stale checkout).
- Rules of the code: `<worktree>/web/CLAUDE.md` (read it; ~140 lines). Long docs (`docs/design/SPEC.md` 1.7k lines,
  `docs/web-page-flows.md`, `docs/web-engine-data-flow.md`): grep for the section you need, never read whole.
- The maintainer's own list of suspected problems: `<worktree>/docs/phase2-plan.md`, section "The audit" (lines ~76-105),
  and `docs/icebox.md`.

## Hard rules
1. Read-only. The ONLY file you create or change is your report file. No edits, no commits, no stash, no branch, no push,
   nothing sent outside this machine, no dev servers. Do not spawn agents. Do not run formatters.
2. Run no command that writes outside ignored caches, and no test suite, unless your own brief says so.
3. Do not skip or soften anything to make the report look complete. Say plainly what you did not read or verify.
4. Never kill a process you did not start.
5. Budget: the number of tool calls in your brief (every call counts). Read files in large ranges (whole file when under
   ~700 lines) rather than many small reads; batch greps into one shell command. If you pass the budget or your context
   is compacted, stop at the next clean point and write the report with what is left undone.

## What to look for (in this order)
1. **Fragility**: state kept in two places; booleans, counters or timers that patch an ordering of asynchronous steps;
   a timer standing in for an event; implicit ordering between modules; error paths that swallow or decide from text;
   code whose correctness depends on a comment being obeyed.
2. **Tangle**: a module that does several jobs; a function too long to hold in the head; knowledge of one thing spread
   over many files; circular or surprising dependencies; an abstraction that hides little or leaks.
3. **Chaff**: dead code, leftovers of earlier steps ("step 4", "poc"), duplicated helpers, options nobody passes,
   comments that narrate history or repeat multi-module documentation (the maintainer: top-of-file comments "keep getting
   changed due to unrelated file changes"; "leave heavy multi-module documentation in text files").
4. **Inconsistency**: the same job done two ways in different places (naming, error handling, how a view reaches state).
5. **Preact lifecycle and raw DOM** (view code): `querySelector` into rendered components, timers waiting for a render,
   focus or scroll moved from outside the owner, effects with missing or over-broad dependencies.
6. **Correctness bugs** you can show with a concrete case. No case, no bug claim: write "suspected" instead.
No style preferences. Every finding has file:line and a one-sentence concrete reason it costs the maintainer.

## Report (write to the path in your brief; hard cap 1,800 words)
1. **Covered**: files read fully / skimmed / not read. Commands run.
2. **Shape** (<=150 words): what the region does and how its pieces depend on each other; the one or two files that
   carry the risk.
3. **Findings**: a table, at most 15 rows, worst first: `id | file:line | kind (fragile/tangle/chaff/inconsistent/
   lifecycle/bug/suspected) | what and why it costs | confidence (read / ran / guess)`.
4. **Candidate work items**: at most 8. Each: what changes, files, size (S <150 changed lines, M <500, L more), risk of
   behaviour change (low/med/high), which existing tests would catch a regression (name the test file; "none" if none),
   and what must land before it.
5. **Redesign question** (<=200 words): if this were your code, is there ONE structural change in or around this region
   that would make future work substantially easier? What it would cost, what it would break, and whether you would
   actually do it now. "No, the structure is sound; tidy it" is a valid answer: do not invent one.
6. **What is good** (<=80 words): structure worth keeping, so the audit does not sand it off.
7. **Not verified**.

Final message to the orchestrator: the report path plus at most 150 words (the three worst findings, your redesign answer
in one line, what you did not cover). Do not repeat the report.
