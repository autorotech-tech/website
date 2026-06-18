#!/usr/bin/env bash
# Install Understand Anything (autorotech-tech fork) for Cursor + Antigravity.
#
# Usage:
#   bash scripts/setup-understand-anything.sh
#   bash scripts/setup-understand-anything.sh --update
#   bash scripts/setup-understand-anything.sh --cursor-only
#   bash scripts/setup-understand-anything.sh --antigravity-only
#
# Env:
#   UA_REPO_URL  default: https://github.com/autorotech-tech/Understand-Anything.git
#   UA_DIR       default: ~/.understand-anything/repo

set -euo pipefail

UA_REPO_URL="${UA_REPO_URL:-https://github.com/autorotech-tech/Understand-Anything.git}"
UA_DIR="${UA_DIR:-$HOME/.understand-anything/repo}"
INSTALL_CURSOR=1
INSTALL_AG=1
DO_UPDATE=0

for arg in "$@"; do
  case "$arg" in
    --update) DO_UPDATE=1 ;;
    --cursor-only) INSTALL_AG=0 ;;
    --antigravity-only) INSTALL_CURSOR=0 ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
  esac
done

mkdir -p "$(dirname "$UA_DIR")"

if [[ ! -d "$UA_DIR/.git" ]]; then
  echo "Cloning Understand Anything → $UA_DIR"
  git clone --depth 1 "$UA_REPO_URL" "$UA_DIR"
elif [[ "$DO_UPDATE" -eq 1 ]]; then
  echo "Updating Understand Anything in $UA_DIR"
  git -C "$UA_DIR" pull --ff-only
fi

SKILLS_SRC="$UA_DIR/understand-anything-plugin/skills"
if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "ERROR: skills not found at $SKILLS_SRC" >&2
  exit 1
fi

link_skills_per_dir() {
  local target_dir="$1"
  local label="$2"
  mkdir -p "$target_dir"
  local count=0
  for skill_dir in "$SKILLS_SRC"/*/; do
    [[ -f "${skill_dir}SKILL.md" ]] || continue
    name="$(basename "$skill_dir")"
    ln -sfn "$skill_dir" "$target_dir/$name"
    count=$((count + 1))
  done
  echo "$label: linked $count skills → $target_dir"
}

if [[ "$INSTALL_AG" -eq 1 ]]; then
  if [[ -x "$UA_DIR/install.sh" ]]; then
    UA_REPO_URL="$UA_REPO_URL" UA_DIR="$UA_DIR" bash "$UA_DIR/install.sh" antigravity
  else
    link_skills_per_dir "${ANTIGRAVITY_SKILLS_DIR:-$HOME/.gemini/antigravity/skills}" "Antigravity"
  fi
fi

if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  link_skills_per_dir "${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills/skills}" "Cursor"
  # Project-local skills (override global when same name)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_AGENT_SKILLS="$(cd "$SCRIPT_DIR/.." && pwd)/.agent/skills"
  mkdir -p "$PROJECT_AGENT_SKILLS"
  ln -sfn "$SKILLS_SRC/understand" "$PROJECT_AGENT_SKILLS/understand"
  ln -sfn "$SKILLS_SRC/understand-dashboard" "$PROJECT_AGENT_SKILLS/understand-dashboard"
  ln -sfn "$SKILLS_SRC/understand-chat" "$PROJECT_AGENT_SKILLS/understand-chat"
  ln -sfn "$SKILLS_SRC/understand-domain" "$PROJECT_AGENT_SKILLS/understand-domain"
  echo "Project skills: $PROJECT_AGENT_SKILLS"
fi

echo
echo "Understand Anything ready."
echo "  Repo: $UA_REPO_URL"
echo "  Path: $UA_DIR"
echo
echo "In Cursor / Antigravity (after restart), run scoped analysis:"
echo "  /understand src/bookmarksBro agent-api extensions/bookmarks-bro --language en"
echo "  /understand-dashboard"
echo
echo "Optional Cursor plugin UI: Settings → Plugins → add $UA_REPO_URL"
