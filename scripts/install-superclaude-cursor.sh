#!/usr/bin/env bash
# Install SuperClaude Framework workflows as Cursor Agent Skills.
# Upstream: https://github.com/SuperClaude-Org/SuperClaude_Framework
# Native target is Claude Code (~/.claude/commands/sc); this maps commands → ~/.cursor/skills/skills/superclaude-*/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${SUPERCLAUDE_VENV:-$HOME/.local/superclaude-venv}"
PY="${VENV}/bin/python3"
SKILLS_DEST="${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills/skills}"
REPO_CLONE="${SUPERCLAUDE_REPO:-/tmp/SuperClaude_Framework}"

if [[ ! -x "$PY" ]]; then
  echo "SuperClaude venv not found at $VENV"
  echo "Create it: python3 -m venv $VENV && $VENV/bin/pip install -e \"$REPO_CLONE[dev]\""
  echo "Or clone: git clone --depth 1 https://github.com/SuperClaude-Org/SuperClaude_Framework.git $REPO_CLONE"
  exit 1
fi

if [[ ! -d "$REPO_CLONE" ]]; then
  echo "Cloning SuperClaude_Framework..."
  git clone --depth 1 https://github.com/SuperClaude-Org/SuperClaude_Framework.git "$REPO_CLONE"
  "$VENV/bin/pip" install -e "$REPO_CLONE[dev]" -q
fi

mkdir -p "$SKILLS_DEST"

export VENV SKILLS_DEST REPO_CLONE

"$PY" <<'PY'
from __future__ import annotations

import re
import shutil
from pathlib import Path
import os

venv = Path(os.environ["VENV"])
skills_dest = Path(os.environ["SKILLS_DEST"])
repo = Path(os.environ["REPO_CLONE"])

# Commands from installed package or repo checkout
try:
    from superclaude.cli.install_commands import _get_commands_source

    commands_src = _get_commands_source()
except Exception:
    commands_src = repo / "src" / "superclaude" / "commands"

if not commands_src.exists():
    raise SystemExit(f"Commands directory not found: {commands_src}")

CURSOR_TRIGGERS = {
    "research": "deep web research, market/competitive intelligence, current events beyond training cutoff, multi-source investigation",
    "brainstorm": "structured brainstorming, ideation, exploring options before implementation",
    "implement": "feature implementation with SuperClaude workflow discipline",
    "pm": "project management, task breakdown, evidence-based implementation gates (90% confidence)",
    "test": "testing strategy, test implementation, QA workflows",
    "analyze": "codebase or system analysis, architecture review",
    "design": "system or UI design, technical design before coding",
    "document": "documentation, technical writing, API docs",
    "troubleshoot": "debugging, root cause analysis, incident investigation",
    "workflow": "multi-step development workflow orchestration",
    "business-panel": "multi-expert business/strategy panel analysis",
    "index-repo": "repository indexing, codebase map, onboarding to large repos",
    "git": "git workflow, commits, branches, PR hygiene",
    "build": "build, compile, deployment preparation",
    "cleanup": "refactoring, dead code removal, codebase cleanup",
    "estimate": "effort estimation, planning",
    "explain": "explain code, concepts, or architecture",
    "improve": "incremental improvement, optimization",
    "reflect": "retrospective, lessons learned, meta-review",
    "recommend": "tool or approach recommendations",
    "task": "task management, todos, execution tracking",
    "agent": "spawn or coordinate specialized agent personas",
    "spawn": "sub-agent or parallel work delegation",
    "spec-panel": "specification review panel",
    "select-tool": "choose tools/MCPs for a task",
    "load": "load project context, PLANNING.md, KNOWLEDGE.md",
    "save": "persist session insights, knowledge capture",
    "index": "indexing, search, knowledge organization",
    "help": "SuperClaude command catalog and usage help",
    "sc": "SuperClaude overview and command router",
}


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, parts[2].lstrip("\n")


def build_skill(name: str, meta: dict[str, str], body: str) -> str:
    desc = meta.get("description", f"SuperClaude workflow: {name}")
    extra = CURSOR_TRIGGERS.get(name, f"SuperClaude /sc:{name} workflow")
    description = (
        f"{desc} Use when the user asks for SuperClaude-style {name}, "
        f"/sc:{name}, or: {extra}."
    )
    header = (
        f"# SuperClaude → Cursor: `{name}`\n\n"
        f"> Adapted from [SuperClaude Framework](https://github.com/SuperClaude-Org/SuperClaude_Framework). "
        f"In Claude Code this is slash command `/sc:{name}` or `/{name}`.\n\n"
    )
    body = body.replace("/sc:", "SuperClaude workflow (sc:)")
    return (
        "---\n"
        f"name: superclaude-{name}\n"
        f"description: {description}\n"
        "---\n\n"
        + header
        + body
    )


installed = 0
for cmd_file in sorted(commands_src.glob("*.md")):
    if cmd_file.stem.lower() == "readme":
        continue
    name = cmd_file.stem
    raw = cmd_file.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)
    skill_dir = skills_dest / f"superclaude-{name}"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(build_skill(name, meta, body), encoding="utf-8")
    installed += 1

# confidence-check skill from repo
conf_src = repo / "skills" / "confidence-check"
if conf_src.is_dir():
    conf_dest = skills_dest / "superclaude-confidence-check"
    if conf_dest.exists():
        shutil.rmtree(conf_dest)
    shutil.copytree(conf_src, conf_dest)
    skill_md = conf_dest / "SKILL.md"
    if skill_md.exists():
        text = skill_md.read_text(encoding="utf-8")
        if "superclaude-confidence-check" not in text:
            text = text.replace(
                "name: Confidence Check",
                "name: superclaude-confidence-check",
                1,
            )
            text = text.replace(
                "description: Pre-implementation confidence",
                "description: SuperClaude pre-implementation confidence check (≥90%). Use before major implementation.",
                1,
            )
            skill_md.write_text(text, encoding="utf-8")
    installed += 1

# Catalog skill
catalog_dir = skills_dest / "superclaude-catalog"
catalog_dir.mkdir(parents=True, exist_ok=True)
cmds = sorted(p.stem for p in commands_src.glob("*.md") if p.name.lower() != "readme.md")
lines = "\n".join(f"- `superclaude-{c}` — /sc:{c}" for c in cmds)
(catalog_dir / "SKILL.md").write_text(
    "---\n"
    "name: superclaude-catalog\n"
    "description: Index of SuperClaude Framework workflows installed for Cursor. "
    "Use when the user mentions SuperClaude, /sc commands, or asks which workflow to use.\n"
    "---\n\n"
    "# SuperClaude catalog (Cursor)\n\n"
    "Pick the matching skill and follow its SKILL.md:\n\n"
    f"{lines}\n\n"
    "Also: `superclaude-confidence-check` before large implementations.\n\n"
    "Upstream: https://github.com/SuperClaude-Org/SuperClaude_Framework\n",
    encoding="utf-8",
)
installed += 1

print(f"Installed {installed} Cursor skills under {skills_dest}")
PY

# Optional: Claude Code install (harmless if unused)
if command -v superclaude >/dev/null 2>&1 || [[ -x "${VENV}/bin/superclaude" ]]; then
  "${VENV}/bin/superclaude" install --force 2>/dev/null || true
fi

echo "Done. Restart Cursor or run: npm run cursor:inventory (if configured)"
echo "CLI: ${VENV}/bin/superclaude  (add to PATH: export PATH=\"${VENV}/bin:\$PATH\")"
