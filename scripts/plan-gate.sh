#!/usr/bin/env bash
# Usage: scripts/plan-gate.sh <base-sha>   (PR_BODY env optional)
# Exits non-zero with one line per violation.
set -euo pipefail

BASE=$1
POLICY=.github/agent-policy.yml
fail=0
err() { echo "::error::$*"; fail=1; }

matches_any() {
  local f=$1; shift
  local p
  for p in "$@"; do [[ $f == $p ]] && return 0; done
  return 1
}

mapfile -t changed < <(git diff --name-only "$BASE"...HEAD)
mapfile -t plans < <(printf '%s\n' "${changed[@]}" | grep -E '^\.agent/plans/.+\.yaml$' | grep -v TEMPLATE || true)

if [[ ${#plans[@]} -ne 1 ]]; then
  err "Expected exactly one plan file in .agent/plans/, found ${#plans[@]}"
  exit 1
fi
plan=${plans[0]}

for key in .intent .why '.scope.paths[0]' '.success_criteria[0]' .risk .rollback; do
  v=$(yq "$key // \"\"" "$plan")
  [[ -n $v ]] || err "Plan $plan is missing $key"
done

mapfile -t scope < <(yq '.scope.paths[]' "$plan")
mapfile -t forbidden < <(yq '.forbidden[]' "$POLICY")

for f in "${changed[@]}"; do
  matches_any "$f" "${forbidden[@]}" && err "Forbidden path changed: $f"
  [[ $f == "$plan" ]] && continue
  matches_any "$f" "${scope[@]}" || err "Outside plan scope: $f"
done

first=$(git rev-list --reverse "$BASE"..HEAD | head -1)
first_files=$(git diff-tree --no-commit-id --name-only -r "$first")
[[ $first_files == "$plan" ]] || err "First commit must contain only the plan file ($plan), got: $(echo $first_files)"

if [[ -n ${PR_BODY:-} ]]; then
  grep -q '^## Plan' <<<"$PR_BODY" || err "PR body is missing the '## Plan' section"
fi

[[ $fail -eq 0 ]] && echo "Plan gate passed: $plan"
exit $fail
