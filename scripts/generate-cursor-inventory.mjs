#!/usr/bin/env node
/**
 * Сканирует skills/rules проекта и (опционально) глобальные skills + MCP.
 * Пишет: .cursor/CURSOR-INVENTORY.generated.md
 * Запуск из корня репозитория website: node scripts/generate-cursor-inventory.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CURSOR = path.join(ROOT, ".cursor");
const OUT = path.join(CURSOR, "CURSOR-INVENTORY.generated.md");

function readFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return {};
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return {};
  const block = raw.slice(4, end);
  const out = {};
  let key = null;
  let buf = [];
  for (const line of block.split("\n")) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) {
      if (key) out[key] = normalizeFmValue(key, buf.join("\n").trim());
      key = m[1];
      buf = [m[2].trim()];
    } else if (key) buf.push(line);
  }
  if (key) out[key] = normalizeFmValue(key, buf.join("\n").trim());
  return out;
}

function normalizeFmValue(key, val) {
  if (key !== "description") return val;
  return val
    .replace(/^\s*>\s*/m, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listSkills(dir, label) {
  const skillsDir = path.join(dir, "skills");
  if (!fs.existsSync(skillsDir)) return { label, items: [] };
  const items = [];
  for (const name of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const md = path.join(skillsDir, name.name, "SKILL.md");
    if (!fs.existsSync(md)) continue;
    const raw = fs.readFileSync(md, "utf8");
    const fm = readFrontmatter(raw);
    items.push({
      folder: name.name,
      name: fm.name || name.name,
      description: (fm.description || "").replace(/\s+/g, " ").trim(),
      disableInvoke: fm["disable-model-invocation"] === "true",
      path: path.relative(ROOT, md),
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { label, items };
}

function listRules(rulesDir) {
  if (!fs.existsSync(rulesDir)) return [];
  const items = [];
  for (const f of fs.readdirSync(rulesDir)) {
    if (!f.endsWith(".mdc")) continue;
    const full = path.join(rulesDir, f);
    const raw = fs.readFileSync(full, "utf8");
    const fm = readFrontmatter(raw);
    items.push({
      file: f,
      description: (fm.description || "").replace(/\s+/g, " ").trim(),
      alwaysApply: fm["alwaysApply"],
      globs: fm.globs,
      path: path.relative(ROOT, full),
    });
  }
  items.sort((a, b) => a.file.localeCompare(b.file));
  return items;
}

function summarizeMcp(home) {
  const p = path.join(home, ".cursor", "mcp.json");
  if (!fs.existsSync(p)) return { path: p, servers: [], note: "файл не найден — настройте MCP в Cursor Settings" };
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const mcpServers = j.mcpServers || j.MCP_SERVERS || {};
    const servers = Object.keys(mcpServers).sort();
    return { path: p, servers, note: null };
  } catch {
    return { path: p, servers: [], note: "не удалось разобрать JSON" };
  }
}

const MAX_GLOBAL_SKILL_NAMES = 35;

function listGlobalSkillRoots(home) {
  const roots = [
    path.join(home, ".cursor", "skills"),
    path.join(home, ".cursor", "skills", "skills"),
    path.join(home, ".agents", "skills"),
  ];
  const blocks = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const names = [];
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const md = path.join(root, ent.name, "SKILL.md");
      if (fs.existsSync(md)) names.push(ent.name);
    }
    if (names.length) {
      const sorted = names.sort();
      blocks.push({
        root,
        names: sorted,
        total: sorted.length,
        preview: sorted.slice(0, MAX_GLOBAL_SKILL_NAMES),
        rest: Math.max(0, sorted.length - MAX_GLOBAL_SKILL_NAMES),
      });
    }
  }
  return blocks;
}

const generatedAt = new Date().toISOString();
const home = process.env.HOME || process.env.USERPROFILE || "";

function mergeProjectSkills() {
  const seen = new Map();
  for (const block of [
    listSkills(CURSOR, ".cursor/skills"),
    listSkills(path.join(ROOT, ".agents"), ".agents/skills"),
  ]) {
    for (const s of block.items) {
      const prev = seen.get(s.name);
      if (!prev || s.path.includes(".agents/skills")) seen.set(s.name, s);
    }
  }
  return {
    label: "Проект (.cursor/skills + .agents/skills)",
    items: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const projectSkills = mergeProjectSkills();
const rules = listRules(path.join(CURSOR, "rules"));
const mcp = summarizeMcp(home);
const globalBlocks = listGlobalSkillRoots(home);

let md = `<!-- Автогенерация: node scripts/generate-cursor-inventory.mjs -->\n`;
md += `**Обновлено:** ${generatedAt}\n\n`;
md += `## Skills (этот репозиторий)\n\n`;
if (!projectSkills.items.length) md += `_Не найдено папок с SKILL.md в .cursor/skills/_\n\n`;
else {
  for (const s of projectSkills.items) {
    md += `### \`${s.name}\`\n`;
    md += `- **Папка:** \`${s.folder}\`\n`;
    md += `- **Файл:** [\`${s.path}\`](${s.path})\n`;
    if (s.description) md += `- **Описание:** ${s.description}\n`;
    md += `- **Автовызов агентом:** ${s.disableInvoke ? "выкл. (только \`/${s.name}\` или @)" : "да (по релевантности)"}\n`;
    md += `- **Команда в чате Agent:** \`/${s.name}\` или текстом «используй skill ${s.name}»\n\n`;
  }
}

md += `## Rules (этот репозиторий)\n\n`;
if (!rules.length) md += `_Нет файлов в .cursor/rules/_\n\n`;
else {
  md += `| Файл | Когда | Режим |\n|------|--------|--------|\n`;
  for (const r of rules) {
    const when = r.description || "—";
    const mode =
      r.alwaysApply === "true"
        ? "alwaysApply"
        : r.globs
          ? `globs: \`${String(r.globs).slice(0, 60)}…\``
          : "intelligent / по описанию";
    md += `| \`${r.file}\` | ${when.replace(/\|/g, "\\|")} | ${mode} |\n`;
  }
  md += `\n`;
}

md += `## Skills (глобально на машине)\n\n`;
if (!globalBlocks.length) {
  md += `_Не найдено ~/.cursor/skills или ~/.agents/skills с SKILL.md_\n\n`;
} else {
  for (const b of globalBlocks) {
    md += `**Корень:** \`${b.root}\` — **всего:** ${b.total} skills\n\n`;
    md += `*В чате Agent список удобнее искать через \`/\` (slash). Ниже — первые ${b.preview.length} по алфавиту.*\n\n`;
    md += b.preview.map((n) => `- \`${n}\``).join("\n");
    md += `\n\n`;
    if (b.rest > 0) {
      md += `_… и ещё ${b.rest}. Полный список: терминал \`ls "${b.root}"\` или поиск в Cursor по папке._\n\n`;
    }
  }
}

md += `## MCP (глобальный конфиг)\n\n`;
md += `**Файл:** \`${mcp.path}\`\n\n`;
if (mcp.note) md += `_${mcp.note}_\n\n`;
else if (!mcp.servers.length) md += `_Секция mcpServers пуста_\n\n`;
else {
  md += `**Серверы:** ${mcp.servers.map((s) => `\`${s}\``).join(", ")}\n\n`;
}

fs.mkdirSync(CURSOR, { recursive: true });
fs.writeFileSync(OUT, md, "utf8");
console.log("Wrote", path.relative(ROOT, OUT));
