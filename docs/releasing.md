# Releasing to PyPI

Status (2026-11-09): `0.1.0.dev0` is on PyPI (https://pypi.org/project/dofile/), uploaded by hand from `origin/main` at
`818f4ed`. It is a pre-release: `pip install dofile` skips it, `pip install --pre dofile` installs it. The version number
is used up for good: PyPI never accepts a number twice, even after a file is deleted. The web demo's landing page labels
`pip install dofile` "with the first release"; keep that label until a non-pre-release is on PyPI.

## What was checked in the first upload (`uv build` of 0.1.0.dev0)
- The wheel holds dofile's MIT `LICENSE` and OpenDTA's `LICENSE` and `THIRD_PARTY_NOTICES.md` (both in
  `dist-info/licenses/`, from `license-files` in `pyproject.toml`, and in `dofile/_vendor/opendta/`).
- The sdist leaves out the Stata 14 reference logs (`tests_opendta/compat/expected`, required by `LICENSE-POLICY.md`),
  `docs/` and `web/`.
- `uvx twine check dist/*` passes for both files; `pyproject.toml` has keywords, classifiers and `[project.urls]` (no
  License classifier: it conflicts with the PEP 639 `license = "MIT"`); the README's links are absolute GitHub URLs, so
  they work on PyPI's page (they point at `main`).
- Smoke test of the uploaded package, from a clean environment: `dofile run` on a do-file with synthetic data (a
  regression; exit code 0, and 1 for a do-file with an error), and `dofile-mcp --http` booted with an MCP client that
  called `start_session`, `run_do` (rc 0, `e(N)` right) and `shell` (refused, rc 199). `sysuse auto` fails by design:
  OpenDTA does not include Stata's example datasets.

## Bumping the version
Bump before the release, in a small pull request of its own (`Release 0.1.0a1`), never after: the tag must equal the
version in `pyproject.toml` at the tagged commit, and PyPI never accepts a number twice. `main` carries the version of
the last release until the next bump, so tagging an unbumped `main` fails at upload ("file already exists").
1. `uv version 0.1.0a1` (or `uv version --bump dev` / `--bump alpha` / `--bump patch` / `--bump minor`; add
   `--dry-run` to preview). It edits `version` in `pyproject.toml` and the dofile entry in `uv.lock` together.
   `__version__` in `src/dofile/__init__.py` follows by itself: it reads the installed package's metadata, which the
   build takes from `pyproject.toml` (an editable install updates when `uv sync` or `uv run` rebuilds it; a bare source
   tree reads `pyproject.toml` itself and reports `X.Y.Z+src`). One place is by hand, and only for a **minor** bump
   (`0.1` → `0.2`): the line "For dofile `0.1.x`" at the top of `MCP-SCHEMA.md`. A patch or pre-release bump never
   touches it, because a patch release must not change the schema (while dofile is 0.x a breaking change raises the
   minor version, per `CLAUDE.md`). `tests/test_version.py` fails if that line, or a stale install, disagrees with
   `pyproject.toml`; it runs in `poe test`, so the release workflow's `build` job fails on a mismatch too. Commit
   `pyproject.toml` and `uv.lock` (and `MCP-SCHEMA.md` for a minor bump) and nothing else.
2. Which number: while dofile is 0.x, a breaking change to the result format raises the minor version (`CLAUDE.md`);
   otherwise raise the patch. Until the first real release use a pre-release (`0.1.0.dev1`, `0.1.0a1`, `0.1.0rc1`);
   PEP 440 orders `.devN` < `aN` < `bN` < `rcN` < the final `0.1.0`, so go in that order and never backwards (a lower
   number than one already on PyPI uploads fine but pip prefers the higher one).
3. Merge the pull request (merge commit, squash or rebase: all work) and let `ci` go green, then tag the release commit
   as it is on `main` (next section).

## Releasing with CI (`.github/workflows/release.yml`)
A push of a tag `vX.Y.Z` (PEP 440: `v0.1.0a1`, `v0.1.0.dev1`, `v0.1.0`) builds, tests and publishes that commit.
1. On `main`: bump the version (previous section), merge it, and let `ci` go green.
2. Tag the release commit on `main` from git (see "Tagging" below): the tag is the version with a `v`.
3. The `build` job refuses a tag that is not on `main` or does not match `pyproject.toml`, runs `poe test`, builds, runs
   `twine check`, installs the wheel alone in a clean environment and runs `dofile run` and `dofile-mcp --help`. The
   `publish` job then uploads with Trusted Publishing (OIDC): no token is stored anywhere. It is a separate job so the
   OIDC permission is never available to the steps that run the project's code.
4. Check the project page and `uvx --prerelease=allow --from dofile==<version> dofile --help`.
5. When the first non-pre-release is out, drop the "with the first release" label from the web demo's landing page.

### Tagging
Tag from git, with an annotated tag, on the exact commit you looked at:
```bash
git switch main && git pull
git log -1                          # confirm it is the "Release 0.1.0a1" commit, as it landed on main
git tag -a v0.1.0a1 -m "dofile 0.1.0a1"   # -s instead of -a to sign, if signing is set up
git push origin v0.1.0a1
```
A rebase or squash merge gives the commit a new SHA on `main`, so always pull first and tag what `main` has, never the
commit on the pull request's branch (the workflow refuses a tag that is not on `main`). Why git and not the GitHub
Releases form: you tag the commit you checked (the form defaults to the tip of `main`, which
may have moved), and an annotated tag records who tagged and when. The push starts the workflow; watch it under the
repository's Actions tab. Optionally, after the upload succeeds, create a GitHub Release from the existing tag for the
notes (tick "pre-release" for `dev`, `a`, `b` and `rc` versions); PyPI does not depend on it.

Consider a tag ruleset for `v*` (Settings → Rules → Rulesets → tags) so only the maintainer can create or delete
release tags; it goes with the `pypi` environment's required reviewer.

### Deleting a tag
Only when the release did **not** reach PyPI: the `build` job failed (the tag was not on `main`, did not match
`pyproject.toml`, a test or the smoke test failed), the reviewer rejected the `publish` job, or `publish` failed before
the upload. Check first at https://pypi.org/project/dofile/#history that the version is not there.
```bash
git push origin --delete v0.1.0a1   # remove the remote tag (the same as git push origin :refs/tags/v0.1.0a1)
git tag -d v0.1.0a1                 # remove the local tag
```
Then fix the cause on `main` through a pull request (if the fix changes the version, bump again) and tag the new
commit. Re-tagging the same number is fine only because nothing was published.

If any file of that version reached PyPI, never move or reuse the tag: the number cannot be uploaded again. Leave the
tag, yank the release if it is bad (Manage project → the release → Yank), bump to the next number and release that. A
partial upload (the wheel but not the sdist) counts as published.

Deleting a tag does not delete a GitHub Release made from it; delete the Release too.

**One-time setup (not done yet; the workflow fails at `publish` until it is):**
- PyPI: project `dofile` → Manage → Publishing → add a GitHub publisher: owner `jeffzyliu`, repository `dofile`,
  workflow `release.yml`, environment `pypi`.
- GitHub: Settings → Environments → create `pypi`. Recommended: add yourself as a required reviewer, so a pushed tag
  waits for a click before anything is published, and limit deployment to tags `v*`.
- Revoke the account-wide token from the first upload.

The workflow's shell steps were run locally (version check, on-main check, build, wheel smoke test) and `actionlint`
passes; the workflow itself has not run on GitHub yet. A tag push is the only way to run it, so the first one is the
real test: use a pre-release number.

## Releasing by hand
1. Two-factor authentication on, and a token scoped to the `dofile` project (PyPI → Account settings → API tokens; the
   first upload needed an account-wide token, because a project-scoped one cannot exist before the project).
2. Version: bump it as under "Bumping the version" and merge. Run `uv run poe ci` first. Use a pre-release until the
   first real release.
3. Build from a clean checkout of the commit: `rm -rf dist && uv build`, then `uvx twine check dist/*`, and look inside
   the wheel (`unzip -l dist/*.whl`) for the license files above.
4. Optional dry run on TestPyPI (a separate account and token):
   `uv publish --publish-url https://test.pypi.org/legacy/ --token pypi-...`
5. `uv publish --token pypi-...`. Never paste the token into a chat or a file: export `UV_PUBLISH_TOKEN` in your own
   shell, or pass it on the command line yourself. The account-wide token used for the first upload was pasted into a
   chat transcript: it must be revoked (PyPI → Account settings → API tokens) if that has not happened yet.
6. Check the project page and `uvx --prerelease=allow --from dofile==<version> dofile --help`.

A bad release cannot be fixed in place: yank it on PyPI (Manage project → the release → Yank) and publish the next
number.
