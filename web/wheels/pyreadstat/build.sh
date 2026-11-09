#!/bin/sh
# Rebuilds ../pyreadstat-<version>-*-pyemscripten_*_wasm32.whl: pyreadstat compiled for Pyodide (no build exists upstream).
# Needs uv and the network (the sdist, then pyodide-build downloads Emscripten). About 5 minutes the first time.
#   sh web/wheels/pyreadstat/build.sh
# Pyodide's ABI (the wheel's platform tag) and Python version must match `web/package.json`'s pyodide: pyodide-build picks
# its cross-build environment from its own version, so pin it below to the one whose `pyodide config get emscripten_version`
# equals Pyodide's (Pyodide 314.0.7 = Emscripten 5.0.3 = pyodide-build 0.39.3).
set -eu
VERSION=1.3.6   # the version the dev group caps at: 1.3.7 returns "" for strL values (docs/phase2-plan.md, "pyreadstat in Pyodide")
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
uv venv -q --python 3.14 .venv
uv pip install -q --python .venv "pyodide-build==0.39.3" pip
.venv/bin/python -m pip download "pyreadstat==$VERSION" --no-binary :all: --no-deps -d src -q
tar xzf src/pyreadstat-$VERSION.tar.gz
cd pyreadstat-$VERSION
patch -p1 < "$HERE/emscripten.patch"
# zlib comes from Emscripten's port; musl has iconv
CFLAGS="--use-port=zlib" LDFLAGS="--use-port=zlib" "$WORK/.venv/bin/pyodide" build . --outdir "$WORK/out"
rm -f "$HERE"/../pyreadstat-*.whl
cp "$WORK"/out/pyreadstat-*.whl "$HERE/.."
ls -l "$HERE"/../pyreadstat-*.whl
