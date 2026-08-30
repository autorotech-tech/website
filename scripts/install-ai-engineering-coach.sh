#!/usr/bin/env bash
# Build and install autorotech-tech/AI-Engineering-Coach VS Code extension (Cursor-compatible).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/autorotech-tech/AI-Engineering-Coach.git}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="${REPO_DIR:-$WEBSITE_ROOT/.cursor/skills/_repos/ai-engineering-coach}"
GLOBAL_SKILLS="${GLOBAL_SKILLS:-$HOME/.cursor/skills/skills}"
GLOBAL_COMMANDS="${GLOBAL_COMMANDS:-$HOME/.cursor/commands}"
PROJECT_COMMANDS="$WEBSITE_ROOT/.cursor/commands"
PROJECT_SKILL="$WEBSITE_ROOT/.cursor/skills/ai-engineering-coach"
SKIP_BUILD="${SKIP_BUILD:-0}"

pick_editor_cli() {
  if command -v cursor >/dev/null 2>&1; then
    echo cursor
  elif command -v code >/dev/null 2>&1; then
    echo code
  else
    echo ""
  fi
}

mkdir -p "$(dirname "$REPO_DIR")" "$GLOBAL_SKILLS" "$PROJECT_SKILL" "$GLOBAL_COMMANDS"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Updating $REPO_DIR ..."
  git -C "$REPO_DIR" pull --ff-only || echo "WARN: git pull failed — using local checkout"
else
  echo "Cloning $REPO_URL -> $REPO_DIR ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "Patching engines.vscode for Cursor compatibility ..."
  node - "$REPO_DIR/package.json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.engines = pkg.engines || {};
pkg.engines.vscode = '^1.105.0';
if (pkg.devDependencies && pkg.devDependencies['@types/vscode']) {
  pkg.devDependencies['@types/vscode'] = '1.105.0';
}
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
NODE
  echo "Installing npm dependencies ..."
  npm install --prefix "$REPO_DIR" @types/vscode@1.105.0 --save-dev
  npm ci --prefix "$REPO_DIR" || npm install --prefix "$REPO_DIR"
  echo "Building VSIX ..."
  npm run package --prefix "$REPO_DIR"
fi

VSIX="$(find "$REPO_DIR" -maxdepth 1 -name 'ai-engineer-coach-*.vsix' -type f | sort -V | tail -1)"
if [[ -z "$VSIX" || ! -f "$VSIX" ]]; then
  echo "ERROR: VSIX not found in $REPO_DIR (run npm run package)" >&2
  exit 1
fi

EDITOR_CLI="$(pick_editor_cli)"
if [[ -n "$EDITOR_CLI" ]]; then
  echo "Installing extension via $EDITOR_CLI ..."
  if ! "$EDITOR_CLI" --install-extension "$VSIX" --force; then
    echo "WARN: VSIX install failed (often engine mismatch). Skill + rules still linked."
    echo "      Retry after Cursor update, or install from Releases when engines match."
  fi
else
  echo "WARN: cursor/code CLI not found. Install manually:"
  echo "  cursor --install-extension $VSIX"
fi

link_skill() {
  local dest="$1"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "ERROR: $dest exists and is not a symlink" >&2
    exit 1
  fi
  ln -sfn "$PROJECT_SKILL" "$dest"
}

link_skill "$GLOBAL_SKILLS/ai-engineering-coach"
mkdir -p "$WEBSITE_ROOT/.agents/skills"
link_skill "$WEBSITE_ROOT/.agents/skills/ai-engineering-coach"

cp -f "$PROJECT_COMMANDS/ai-engineering-coach.md" "$GLOBAL_COMMANDS/ai-engineering-coach.md"

echo ""
echo "AI Engineer Coach (autorotech fork) ready:"
echo "  Repo:      $REPO_DIR"
echo "  VSIX:      $VSIX"
echo "  Skill:     $GLOBAL_SKILLS/ai-engineering-coach"
echo "  Dashboard: Command Palette → AI Engineer Coach: Open Dashboard"
echo "  Reload:    AI Engineer Coach: Reload Data"
echo ""
