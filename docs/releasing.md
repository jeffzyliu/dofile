# Releasing to PyPI

Status (2026-11-09): the name `dofile` is not taken on PyPI (no project). The maintainer has a PyPI account; nothing
has been uploaded yet. PyPI does not reserve names: only a first upload creates the project, so until then anyone can
take it. The web demo's landing page labels `pip install dofile` "with the first release".

## What was checked (2026-11-09, `uv build` of 0.1.0.dev0)
- The wheel holds dofile's MIT `LICENSE` and OpenDTA's `LICENSE` and `THIRD_PARTY_NOTICES.md` (both in
  `dist-info/licenses/`, from `license-files` in `pyproject.toml`, and in `dofile/_vendor/opendta/`).
- The sdist leaves out the Stata 14 reference logs (`tests_opendta/compat/expected`, required by `LICENSE-POLICY.md`),
  `docs/` and `web/`.
- `uvx twine check dist/*` passes for both files.
- Not done: `[project.urls]` (homepage, source, issues) and classifiers are missing from `pyproject.toml`; the
  README's relative links (`MCP-SCHEMA.md`, `docs/...`, `plugins/...`) will not work on PyPI's page. Fix before the
  first real release, or accept them for a preview upload.

## The first upload (creates the project)
1. Turn on two-factor authentication on the PyPI account; uploads require it.
2. Build from a clean checkout of a commit: `rm -rf dist && uv build`, then `uvx twine check dist/*`. Look inside the
   wheel (`unzip -l dist/*.whl`) for the license files above.
3. Version: a version number can never be uploaded twice, even after it is deleted. Upload a dev or pre-release
   (`0.1.0.dev0`, `0.1.0a1`), not `0.1.0`: pip skips pre-releases unless asked (`pip install --pre dofile`), so a plain
   `pip install dofile` does not install a preview by accident, and `0.1.0` stays free for the real first release.
4. Optional dry run on TestPyPI (a separate account and token):
   `uv publish --publish-url https://test.pypi.org/legacy/ --token pypi-...`
5. Create an account-wide API token on PyPI (a project-scoped token cannot exist before the project does), then
   `uv publish --token pypi-...`. Check https://pypi.org/project/dofile/.
6. Delete that account-wide token.

## Later releases
- Set up Trusted Publishing on PyPI (Manage project → Publishing) for the repository's GitHub Actions workflow, and
  publish from CI with `uv publish` (no stored token; the workflow needs `permissions: id-token: write`). Until then,
  use a token scoped to the `dofile` project only.
- Each release: bump `version` in `pyproject.toml`; while dofile is 0.x, a breaking change to the result format raises
  the minor version (`CLAUDE.md`). Run `uv run poe ci` first. The web demo's landing page drops its "with the first
  release" label once a non-pre-release is on PyPI.
