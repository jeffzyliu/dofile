#!/bin/bash
# PostToolUse hook for dofile's run_do: show the call's `log` to the user (systemMessage), not to the model.
# Reads only the hook JSON on stdin (so it works over stdio and HTTP) and prints nothing if there is no log. Needs jq.
# A long run's log is already cut by the server; the full text is in the file that `log_file` names.
in=$(cat)
# with graphs attached tool_response is an array of blocks (image, caption, JSON text); without, one JSON string
res=$(printf '%s' "$in" | jq -c '.tool_response | (if type=="array" then map(.text? // empty) else [.] end) | map(try fromjson catch empty | select(type=="object" and has("log"))) | .[0] // empty' 2>/dev/null)
[ -n "$res" ] || exit 0
# control characters from the data (ESC, BEL: a .dta string can hold them) would reach the terminal: keep only tab and newline
all=$(printf '%s' "$res" | jq -r '.log' | LC_ALL=C tr -d '\000-\010\013-\037\177')
[ -n "$all" ] || exit 0
name=$(printf '%s' "$res" | jq -r '.log_file // empty')
tint=$'\033[38;5;74m'; reset=$'\033[0m'  # steel blue (256-colour 74): sets the log apart from the hook's label line
width=78  # as wide as a Stata table rule
rule() { printf '─%.0s' $(seq 1 "$1"); }  # $1 = number of dashes
tail_label=" ${name:-run_do log} ──"
top="$(rule $((width - ${#tail_label})))$tail_label"  # file name at the right end of the bar
max=9000  # bytes: Claude Code saves a hook message over about 10,000 characters to a file and shows 2 KB of it
n=$(printf '%s\n' "$all" | wc -l)
# the UI resets colour at each newline, so every line gets its own tint (and no per-line reset); the leading newline keeps the bar off the label line
build() {  # $1 = lines kept from each end (0: all)
  local body="$all"
  if [ "$1" -gt 0 ]; then
    body=$(printf '%s\n' "$all" | head -"$1"; echo "[... $((n - 2 * $1)) lines omitted${name:+; full log: .dofile/$name} ...]"; printf '%s\n' "$all" | tail -"$1")
  fi
  printf '\n%s\n%s\n%s\n' "$top" "$body" "$(rule "$width")" | awk -v t="$tint" '{print t $0}' | sed '$ s/$/'"$reset"'/'
}
text=$(build 0)
k=$((n / 2))
while [ "${#text}" -gt 0 ] && [ "$(printf '%s' "$text" | wc -c)" -gt "$max" ] && [ "$k" -gt 5 ]; do
  text=$(build "$k"); k=$((k - 5))
done
jq -n --arg m "$text" '{systemMessage: $m}'
