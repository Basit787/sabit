#!/usr/bin/env bash
# Creates or updates the GitHub labels listed in .github/labels.yml.
# Usage: scripts/sync-labels.sh [owner/repo]   (requires `gh auth login`)
set -euo pipefail
repo="${1:-}"
args=()
[[ -n "$repo" ]] && args=(--repo "$repo")

grep -E '^- \{' .github/labels.yml | while IFS= read -r line; do
  name=$(sed -E 's/.*name: ([^,]+),.*/\1/' <<<"$line")
  color=$(sed -E 's/.*color: ([0-9a-f]+),.*/\1/' <<<"$line")
  description=$(sed -E 's/.*description: "([^"]*)".*/\1/' <<<"$line")
  gh label create "$name" --color "$color" --description "$description" --force ${args[@]+"${args[@]}"}
done
