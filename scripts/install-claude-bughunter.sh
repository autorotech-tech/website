#!/usr/bin/env bash
# Install elementalsouls/Claude-BugHunter for Cursor (skills + slash commands).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/elementalsouls/Claude-BugHunter.git}"
REPO_DIR="${REPO_DIR:-$HOME/.cursor/skills/_repos/Claude-BugHunter}"
GLOBAL_SKILLS="${GLOBAL_SKILLS:-$HOME/.cursor/skills/skills}"
GLOBAL_COMMANDS="${GLOBAL_COMMANDS:-$HOME/.cursor/commands}"
PREFIX="${PREFIX:-cbh-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_COMMANDS="$WEBSITE_ROOT/.cursor/commands"

mkdir -p "$(dirname "$REPO_DIR")" "$GLOBAL_SKILLS" "$GLOBAL_COMMANDS" "$PROJECT_COMMANDS"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Updating $REPO_DIR ..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "Cloning $REPO_URL -> $REPO_DIR ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

node - "$REPO_DIR" "$GLOBAL_SKILLS" "$PREFIX" <<'NODE'
const fs = require('fs');
const path = require('path');

const repoDir = process.argv[2];
const globalSkills = process.argv[3];
const prefix = process.argv[4];

const skillsRoot = path.join(repoDir, 'skills');
if (!fs.existsSync(skillsRoot)) {
  console.error('No skills/ directory in repo');
  process.exit(1);
}

function readDescription(skillPath, folder) {
  const raw = fs.readFileSync(skillPath, 'utf8');
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4);
    if (end !== -1) {
      const block = raw.slice(4, end);
      const m = /^description:\s*(.+)$/m.exec(block);
      if (m) return m[1].trim();
    }
  }
  const first = raw.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return `Claude-BugHunter: ${folder}. ${(first || '').slice(0, 120)}`;
}

function ensureFrontmatter(skillPath, skillName, description, categoryPath) {
  let body = fs.readFileSync(skillPath, 'utf8');
  if (body.startsWith('---\n')) return;
  const header = [
    '---',
    `name: ${skillName}`,
    `description: ${description} Repo path: ${categoryPath}.`,
    '---',
    '',
    `> **Cursor install:** run commands from \`${categoryPath}\` when scripts are referenced.`,
    '',
  ].join('\n');
  fs.writeFileSync(skillPath, header + body);
}

let linked = 0;
for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const category = ent.name;
  const categoryPath = path.join(skillsRoot, category);
  const skillMd = path.join(categoryPath, 'SKILL.md');
  if (!fs.existsSync(skillMd)) continue;

  const skillName = `${prefix}${category}`;
  const desc = readDescription(skillMd, category);
  ensureFrontmatter(skillMd, skillName, desc, categoryPath);

  const linkPath = path.join(globalSkills, skillName);
  try {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
  } catch (_) {}
  fs.symlinkSync(categoryPath, linkPath);
  linked++;
}

const catalogName = `${prefix}catalog`;
const metaDir = path.join(globalSkills, catalogName);
if (fs.existsSync(metaDir)) {
  try {
    const st = fs.lstatSync(metaDir);
    if (st.isSymbolicLink()) fs.unlinkSync(metaDir);
  } catch (_) {}
}
fs.mkdirSync(metaDir, { recursive: true });

const huntSkills = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .map((e) => e.name)
  .filter((n) => n.startsWith('hunt-'))
  .sort();

const catalogBody = [
  '---',
  `name: ${catalogName}`,
  'description: Index of Claude-BugHunter skills (bug bounty, pentest, triage). Use for security debugging, validation gates, and hunt-* playbooks. Pair with systematic-debugging for app bugs.',
  '---',
  '',
  '# Claude-BugHunter (Cursor)',
  '',
  `Repository: \`${repoDir}\``,
  '',
  '## Slash commands (Cursor chat)',
  '',
  'In Agent chat: `/triage`, `/validate`, `/report`, `/recon`, `/hunt`, `/chain`, `/surface`, `/intel`, `/pickup`, `/remember`, `/autopilot`, `/token-scan`, `/web3-audit`, `/memory-gc`',
  '',
  '## App / infra debugging (this project)',
  '',
  '1. **systematic-debugging** — root cause before fixes (tests, 502, regressions).',
  '2. **cbh-triage-validation** — 7-Question Gate when a finding might be security-related.',
  '3. **cbh-hunt-dispatch** + relevant **cbh-hunt-*** for OWASP class (xss, sqli, idor, ssrf, auth).',
  '4. **cbh-bb-methodology** — full engagement workflow if doing structured security pass.',
  '',
  '## Hunt skills',
  '',
  ...huntSkills.map((k) => `- \`${prefix}${k}\``),
  '',
].join('\n');
fs.writeFileSync(path.join(metaDir, 'SKILL.md'), catalogBody);

console.log(JSON.stringify({ linked, catalogName, repoDir, globalSkills, prefix }));
NODE

echo "Commands → $GLOBAL_COMMANDS and $PROJECT_COMMANDS"
for cmd_file in "$REPO_DIR/commands"/*.md; do
  [ -e "$cmd_file" ] || continue
  cmd_name="$(basename "$cmd_file")"
  cp -f "$cmd_file" "$GLOBAL_COMMANDS/$cmd_name"
  cp -f "$cmd_file" "$PROJECT_COMMANDS/$cmd_name"
  echo "  ✓ /${cmd_name%.md}"
done

# cbh-debug-playbook is a real file in repo (.cursor/skills/cbh-debug-playbook/SKILL.md)
mkdir -p "$WEBSITE_ROOT/.agents/skills"
ln -sfn "$WEBSITE_ROOT/.cursor/skills/cbh-debug-playbook" "$WEBSITE_ROOT/.agents/skills/cbh-debug-playbook"

echo ""
echo "Installed Claude-BugHunter for Cursor:"
echo "  Repo:      $REPO_DIR"
echo "  Skills:    $GLOBAL_SKILLS/${PREFIX}* ($(ls -1d "$GLOBAL_SKILLS/${PREFIX}"* 2>/dev/null | wc -l | tr -d ' ') entries)"
echo "  Commands:  $PROJECT_COMMANDS/*.md"
echo "  Rule:      $WEBSITE_ROOT/.cursor/rules/claude-bughunter-debug.mdc"
echo ""
echo "Optional CLI: source $REPO_DIR/scripts/hunt.sh  (engagement scaffold)"
echo "Refresh inventory: npm run cursor:inventory"
