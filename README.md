# dofile

Run Stata-syntax `.do` files without a Stata license, and expose them to AI agents over MCP.

Status: Phase 1 in progress (see `docs/phase1-plan.md`).

The engine is a vendored copy of [OpenDTA](https://github.com/yaskepalhares/opendta) (MIT), pinned in
`src/dofile/_vendor/opendta/VENDORED`. Not affiliated with StataCorp; Stata is a registered trademark of StataCorp LLC.
