#!/usr/bin/env bash
# Usage: scripts/risk-tier.sh <base-sha>
# Prints low | medium | high: the highest tier any changed path falls in.
set -euo pipefail

BASE=$1
POLICY=.github/agent-policy.yml

matches_any() {
  local f=$1; shift
  local p
  for p in "$@"; do [[ $f == $p ]] && return 0; done
  return 1
}

mapfile -t high < <(yq '.tiers.high[]' "$POLICY")
mapfile -t medium < <(yq '.tiers.medium[]' "$POLICY")
mapfile -t low < <(yq '.tiers.low[]' "$POLICY")

tier=low
while read -r f; do
  [[ -z $f ]] && continue
  if matches_any "$f" "${high[@]}"; then echo high; exit 0
  elif matches_any "$f" "${medium[@]}"; then tier=medium
  elif ! matches_any "$f" "${low[@]}"; then echo high; exit 0
  fi
done < <(git diff --name-only "$BASE"...HEAD)

echo "$tier"
