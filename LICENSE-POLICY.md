# License and clean-room policy

dofile is MIT-licensed (see [LICENSE](LICENSE)). Its Stata engine is OpenDTA, also MIT, vendored in
[`src/dofile/_vendor/opendta`](src/dofile/_vendor/opendta) with its own
[LICENSE](src/dofile/_vendor/opendta/LICENSE) and
[third-party notices](src/dofile/_vendor/opendta/THIRD_PARTY_NOTICES.md).

This policy keeps dofile free of StataCorp's protected material and of copyleft code, so that it
stays MIT for everyone who uses or embeds it. It follows OpenDTA's
[clean-room policy](src/dofile/_vendor/opendta/CLEAN_ROOM_POLICY.md)
([upstream](https://github.com/yaskepalhares/opendta/blob/0c3f3a2d65654bc95b495f56a8e8b8fff4e02a57/docs/clean-room-policy.md)),
which applies in full to any change to the engine.

## Clean room: Stata

dofile reimplements Stata's documented *behavior*. It contains no StataCorp code or files.

**May be used as a source**

- The Stata manuals, the public help and the public FAQs
- The public specification of the `.dta` format
- Papers, books and teaching materials about Stata and about the statistical methods
- Observed behavior: running a do-file in a licensed Stata and comparing its output with dofile's
- Open-source libraries with a compatible license (see below)

**May not be used**

- Files distributed with Stata: `.ado`, `.mo`, `.mlib`, `.sthlp`, `.dlg`, `.scheme`, neither copied
  nor adapted
- Text copied from the manuals or help: describe behavior in your own words
- Stata's example datasets (`sysuse`/`webuse` files such as `auto.dta`): use synthetic or openly
  licensed data
- Decompiling, disassembling or inspecting Stata's executables and libraries
- Stata's icons, logos and other graphical elements

**In practice**

- Write each command from the manual. When the manual leaves a detail undefined, mark the code
  `VERIFY` and add a case that a Stata run can settle.
- Stata output used to check results (logs, coefficients) stays in the test folders and is never
  shipped in the package.
- Use "Stata-compatible" or "runs Stata-syntax code" to describe dofile, never "Stata" in a package
  or product name. Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with
  StataCorp.

## Licenses of code and dependencies

- **Allowed** in shipped code and as dependencies: permissive licenses (MIT, BSD, Apache-2.0,
  PSF, ISC) and the Python and Pyodide runtimes.
- **Allowed for fonts:** the SIL Open Font License 1.1, with the license file next to the font files. The web demo
  uses IBM Plex Mono and IBM Plex Sans (`docs/design/fonts/`, later `web/`), unchanged: Fontsource's Latin subsets,
  plus IBM's complete files (`*-complete.woff2`, from the `@ibm/plex-mono` and `@ibm/plex-sans` npm packages 2.5.0 and
  1.1.0; fetch command in `docs/design/mockups/README.md`) for the arrows, box-drawing and block characters. IBM's license reserves the name "Plex", so a font we subset or edit ourselves must be renamed.
- **Allowed only as a separate dependency**, never copied into the source: LGPL libraries.
- **Not allowed** in `src/`, as a runtime dependency or in the web demo: GPL, AGPL and other strong
  copyleft code. This includes the GPLv3 tree-sitter-stata grammar (jbearak); use an MIT grammar
  such as codedthinking's instead.
- **Fine outside the shipped package:** GPL tools used to produce test references (R, gretl) and
  reading copyleft code to understand an algorithm, as long as you write your own version.
- Vendored code keeps its license file and a `VENDORED` stamp with its source and commit, and is
  updated only by [`scripts/vendor_opendta.py`](scripts/vendor_opendta.py).
- Before adding a dependency or vendoring code, check its license (and its dependencies').
