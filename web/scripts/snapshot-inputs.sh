#!/bin/sh
# snapshot-inputs.sh build | all | key: reads snapshot-inputs.txt, in shell so that a CI job needs no Node.
#   build, all  the pathspecs of that section (all: both sections), one per line, from the repository root
#   key         the hash of the tracked files the build section names: the cache key of the snapshot
set -eu
cd "$(dirname "$0")/../.."
section() { awk -v want="$1" '/^#/ || NF == 0 { next } /^\[/ { sec = substr($0, 2, length($0) - 2); next } want == "all" || want == sec' web/scripts/snapshot-inputs.txt; }
case "${1:-}" in
  build | all) section "$1" ;;
  key)
    # no pipefail in sh: each step that can fail is its own command, so a git failure stops the script (no constant key)
    git rev-parse --git-dir > /dev/null || { echo "snapshot-inputs.sh key: not a git checkout, no key" >&2; exit 1; }
    files=$(section build | tr '\n' '\0' | xargs -0 git ls-files --)
    [ -n "$files" ] || { echo "snapshot-inputs.sh key: the build section names no tracked file" >&2; exit 1; }
    printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 ;;
  *) echo "usage: snapshot-inputs.sh build | all | key" >&2; exit 2 ;;
esac
