#!/bin/zsh
# Daily odometer sync: pull from Toyota, push to GitHub Pages if changed.
# Run by launchd (see com.camry.mileage-sync.plist). Safe to run by hand.
set -e
cd "$(dirname "$0")/.."

# No tokens yet -> setup hasn't been run; exit quietly.
[ -f sync/tokens.json ] || exit 0

sync/.venv/bin/python sync/pull_odometer.py pull

if ! git diff --quiet -- sync/readings.json 2>/dev/null || \
   [ -n "$(git status --porcelain sync/readings.json 2>/dev/null)" ]; then
  git add sync/readings.json
  git commit -m "odometer sync $(date +%F)"
  git push
fi
