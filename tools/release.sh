#!/usr/bin/env bash
# Build module.zip from the committed tree (HEAD). Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./module.json').version")
git archive --format=zip -o module.zip HEAD module.json scripts lang README.md
echo "module.zip built for v$VERSION"
echo "Next:"
echo "  git tag v$VERSION && git push origin main --tags"
echo "  gh release create v$VERSION module.zip module.json --title \"v$VERSION\" --notes \"...\""
