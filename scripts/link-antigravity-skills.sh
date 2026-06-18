#!/usr/bin/env bash
# Симлинки skills из коллекции Cursor (superpowers) в каталог Antigravity.
set -euo pipefail
SRC="${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills/skills}"
DEST="${ANTIGRAVITY_SKILLS_DIR:-$HOME/.gemini/antigravity/skills}"
mkdir -p "$DEST"
count=0
for d in "$SRC"/*/; do
  [[ -f "${d}SKILL.md" ]] || continue
  name="$(basename "$d")"
  ln -sfn "$d" "$DEST/$name"
  count=$((count + 1))
done
echo "Symlinked $count skills: $SRC -> $DEST"
