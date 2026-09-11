#!/usr/bin/env bash
# Point the formula at a release: script/homebrew/update.sh <release tag> <version>
#   e.g. script/homebrew/update.sh studio-v0.1.1 0.1.1
set -euo pipefail
TAG="${1:?release tag}"; VER="${2:?version}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHA=$(gh release download "$TAG" -R MST-betterAI/mindscript-studio -p "mindscript-darwin-arm64.zip.sha256" -O - | cut -d' ' -f1)
F="$ROOT/script/homebrew/mindscript.rb"
sed -i '' -e "s|version \".*\"|version \"$VER\"|" -e "s|releases/download/[^/]*/|releases/download/$TAG/|" -e "s|sha256 \".*\"|sha256 \"$SHA\"|" "$F"
echo "formula now points at $TAG ($SHA)"
