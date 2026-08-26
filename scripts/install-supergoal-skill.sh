#!/usr/bin/env bash
# Install autorotech-tech/supergoal for Cursor (skill + slash command + path symlinks).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/autorotech-tech/supergoal.git}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEBSITE_REPO="$WEBSITE_ROOT/.cursor/skills/_repos/supergoal"
if [[ -z "${REPO_DIR:-}" ]]; then
  if [[ -d "$WEBSITE_REPO/.git" ]]; then
    REPO_DIR="$WEBSITE_REPO"
  else
    REPO_DIR="$HOME/.cursor/skills/_repos/supergoal"
  fi
fi
GLOBAL_SKILLS="${GLOBAL_SKILLS:-$HOME/.cursor/skills/skills}"
GLOBAL_COMMANDS="${GLOBAL_COMMANDS:-$HOME/.cursor/commands}"
PROJECT_COMMANDS="$WEBSITE_ROOT/.cursor/commands"
SKILL_SRC_REL="skills/supergoal"

mkdir -p "$(dirname "$REPO_DIR")" "$GLOBAL_SKILLS" "$GLOBAL_COMMANDS" "$PROJECT_COMMANDS"
mkdir -p "$WEBSITE_ROOT/.agents/skills" "$WEBSITE_ROOT/.cursor/skills"
mkdir -p "$HOME/.claude/skills" "$WEBSITE_ROOT/.claude/skills"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Updating $REPO_DIR ..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "Cloning $REPO_URL -> $REPO_DIR ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

SKILL_SRC="$REPO_DIR/$SKILL_SRC_REL"
if [[ ! -f "$SKILL_SRC/SKILL.md" ]]; then
  echo "ERROR: expected $SKILL_SRC/SKILL.md" >&2
  exit 1
fi

link_skill() {
  local dest="$1"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "ERROR: $dest exists and is not a symlink" >&2
    exit 1
  fi
  ln -sfn "$SKILL_SRC" "$dest"
}

link_skill "$GLOBAL_SKILLS/supergoal"
link_skill "$WEBSITE_ROOT/.agents/skills/supergoal"
link_skill "$WEBSITE_ROOT/.cursor/skills/supergoal"
link_skill "$HOME/.claude/skills/supergoal"
link_skill "$WEBSITE_ROOT/.claude/skills/supergoal"

CMD_SRC="$WEBSITE_ROOT/.cursor/commands/supergoal.md"
cp -f "$CMD_SRC" "$GLOBAL_COMMANDS/supergoal.md"

echo ""
echo "Installed supergoal for Cursor:"
echo "  Repo:     $REPO_DIR"
echo "  Skill:    $GLOBAL_SKILLS/supergoal -> $SKILL_SRC"
echo "  Project:  $WEBSITE_ROOT/.agents/skills/supergoal"
echo "  Command:  /supergoal ($PROJECT_COMMANDS/supergoal.md)"
echo ""
echo "Usage: in Agent chat — /supergoal <task>  or ask to run the supergoal skill."
echo "Refresh inventory: npm run cursor:inventory"
