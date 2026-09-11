#!/usr/bin/env bash
# Rebase MindScript Studio onto a newer upstream OpenCode tag.
#   script/upstream/merge.sh v1.19.4
# Steps: fetch the tag → merge it into the current branch → re-apply the branding
# (idempotent) → typecheck → report what still carries upstream names.
# Conflicts are expected only in files with a `mindscript_change` marker.
set -euo pipefail
TAG="${1:?usage: script/upstream/merge.sh <upstream tag, e.g. v1.19.4>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/anomalyco/opencode.git
git fetch -q --tags upstream
git diff --quiet || { echo "working tree not clean — commit or stash first" >&2; exit 1; }
echo "== merging upstream $TAG into $(git rev-parse --abbrev-ref HEAD) =="
if ! git merge --no-edit "$TAG"; then
  echo
  echo "Merge conflicts. Files with our markers: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
  echo "Resolve them, then run:  bun script/branding/apply.ts && bun run typecheck && git commit"
  exit 2
fi
echo "$TAG" > .opencode-version
echo "== re-applying branding =="
bun script/branding/apply.ts
bun install >/dev/null
echo "== typecheck =="
bun run typecheck 2>&1 | tail -5
echo "== forbidden upstream strings in shipped code (should be empty) =="
grep -rn --exclude-dir=node_modules --exclude-dir=.git -E "opncd\.ai/s/|app\.opencode\.ai" packages/opencode/src packages/app/src packages/desktop/src 2>/dev/null | head -10 || true
git add -A && git commit -q -m "upstream $TAG merged; branding re-applied" && echo "committed. Now: rebuild (packages/opencode: bun run script/build.ts --single) and smoke-test."
