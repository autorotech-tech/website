#!/usr/bin/env node
/**
 * Build RU/EN portfolio HTML and export PDF via Playwright.
 * Usage: node portfolio/build-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8'));

const ASSISTANT = {
  en: {
    title: 'Personal Telegram Assistant',
    caption:
      'Single-bot gateway at /api/v1/telegram/autoro-gateway: assistant commands and memory go to n8n (/research, /context), fallback to Hermes. Assistant Memory UI syncs tasks and notes to Obsidian.',
    task: 'Personal productivity assistant in Telegram with long-term memory, research commands and Obsidian sync.',
    role: 'Gateway routing in agent-api, n8n workflows, Assistant Memory admin UI, Obsidian MCP integration.',
    stack: ['Telegram Bot API', 'FastAPI agent-api', 'n8n', 'Supabase personal_assistant_memory', 'Obsidian MCP', 'Hermes fallback'],
    results: 'Daily use: capture tasks/notes from Telegram, research commands, memory dashboard in Swoop admin.',
  },
  ru: {
    title: 'Личный Telegram-ассистент',
    caption:
      'Единый webhook /api/v1/telegram/autoro-gateway: команды ассистента и память уходят в n8n (/research, /context), остальное - fallback Hermes. Assistant Memory UI синхронизирует задачи и заметки в Obsidian.',
    task: 'Личный productivity-ассистент в Telegram с долгой памятью, research-командами и sync в Obsidian.',
    role: 'Gateway routing в agent-api, n8n workflows, Assistant Memory admin UI, интеграция Obsidian MCP.',
    stack: ['Telegram Bot API', 'FastAPI agent-api', 'n8n', 'Supabase personal_assistant_memory', 'Obsidian MCP', 'Hermes fallback'],
    results: 'Ежедневное использование: capture задач/заметок из Telegram, research-команды, memory dashboard в Swoop admin.',
  },
};

const META = {
  en: {
    docTitle: 'Autoro Swoop - MVP Portfolio',
    lang: 'en',
    heroTitle: 'Autoro Swoop',
    heroSub: 'AI Marketing Platform - Prototypes & MVP',
    heroLead:
      'Modular B2B platform for marketing automation, RAG chat agents, research, scraping and voice AI. Built with vibecoding (Cursor, Antigravity) + production backend on FastAPI. Professional background also includes Social Engineering (defensive awareness), human-factor security and phishing-aware workflows.',
    author: 'Vladislav Kholodin',
    contacts: 'autoro.tech@gmail.com · t.me/vlad_xg · linkedin.com/in/vlad-autoro-tech',
    site: 'https://autoro.tech',
    swoop: 'https://swoop.autoro.tech',
    resume: 'https://autoro.tech/resume/',
    sectionStack: 'Stack',
    sectionTask: 'Problem',
    sectionRole: 'My role',
    sectionResults: 'Results',
    platformTitle: 'Platform stack (shared)',
    platformStack:
      'React 18 · TypeScript · Vite · Tailwind · FastAPI agent-api · PostgreSQL/Supabase · pgvector · Docker · n8n · OpenRouter/Gemini/GLM · Cursor · Antigravity · MCP',
    assistantSection: 'Additional module (no screenshot)',
    footer: 'Portfolio generated from live Swoop admin modules · 2026',
    screenshotDir: 'screenshots-en',
  },
  ru: {
    docTitle: 'Autoro Swoop - Портфолио MVP',
    lang: 'ru',
    heroTitle: 'Autoro Swoop',
    heroSub: 'AI Marketing Platform - прототипы и MVP',
    heroLead:
      'Модульная B2B-платформа для marketing automation, RAG chat agents, research, scraping и voice AI. Сборка через vibecoding (Cursor, Antigravity) + production backend на FastAPI.',
    author: 'Владислав Холодин',
    contacts: 'autoro.tech@gmail.com · t.me/vlad_xg · linkedin.com/in/vlad-autoro-tech',
    site: 'https://autoro.tech',
    swoop: 'https://swoop.autoro.tech',
    resume: 'https://autoro.tech/resume/',
    sectionStack: 'Стек',
    sectionTask: 'Задача',
    sectionRole: 'Моя роль',
    sectionResults: 'Результат',
    platformTitle: 'Общий стек платформы',
    platformStack:
      'React 18 · TypeScript · Vite · Tailwind · FastAPI agent-api · PostgreSQL/Supabase · pgvector · Docker · n8n · OpenRouter/Gemini/GLM · Cursor · Antigravity · MCP',
    assistantSection: 'Дополнительный модуль (без скриншота)',
    footer: 'Портфолио по live-модулям Swoop admin · 2026',
    screenshotDir: 'screenshots',
  },
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildProjectCard(p, m, lang) {
  const isEn = lang === 'en';
  const img = path.join(m.screenshotDir, p.image);
  return `
    <article class="project page-break">
      <img src="${esc(img)}" alt="${esc(isEn ? p.title_en : p.title_ru)}" />
      <div class="body">
        <div class="head">
          <h2>${esc(isEn ? p.title_en : p.title_ru)}</h2>
          <span class="badge">${esc(p.status)}</span>
          ${p.url ? `<a class="url" href="${esc(p.url)}">${esc(p.url.replace('https://', ''))}</a>` : ''}
        </div>
        <p class="lead">${esc(isEn ? p.caption_en : p.caption_ru)}</p>
        <dl>
          <dt>${esc(m.sectionTask)}</dt><dd>${esc(isEn ? p.task_en : p.task_ru)}</dd>
          <dt>${esc(m.sectionRole)}</dt><dd>${esc(isEn ? p.role_en : p.role_ru)}</dd>
          <dt>${esc(m.sectionStack)}</dt><dd>${esc(p.stack.join(' · '))}</dd>
          <dt>${esc(m.sectionResults)}</dt><dd>${esc(isEn ? p.results_en : p.results_ru)}</dd>
        </dl>
      </div>
    </article>`;
}

function buildAssistantCard(m, lang) {
  const a = ASSISTANT[lang];
  return `
    <article class="project assistant page-break">
      <div class="assistant-banner">
        <div class="icon">TG</div>
        <div>
          <h2>${esc(a.title)}</h2>
          <p>${esc(a.caption)}</p>
        </div>
      </div>
      <div class="body">
        <dl>
          <dt>${esc(m.sectionTask)}</dt><dd>${esc(a.task)}</dd>
          <dt>${esc(m.sectionRole)}</dt><dd>${esc(a.role)}</dd>
          <dt>${esc(m.sectionStack)}</dt><dd>${esc(a.stack.join(' · '))}</dd>
          <dt>${esc(m.sectionResults)}</dt><dd>${esc(a.results)}</dd>
        </dl>
        <pre class="flow">Telegram Bot
  → agent-api /api/v1/telegram/autoro-gateway
  → n8n (assistant + memory commands)
  → Supabase personal_assistant_memory
  → Obsidian vault sync
  → fallback: Hermes webhook</pre>
      </div>
    </article>`;
}

function buildHtml(lang) {
  const m = META[lang];
  const cards = projects.map((p) => buildProjectCard(p, m, lang)).join('\n');
  const assistant = buildAssistantCard(m, lang);
  return `<!DOCTYPE html>
<html lang="${m.lang}">
<head>
  <meta charset="UTF-8" />
  <title>${esc(m.docTitle)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111; line-height: 1.45; font-size: 11pt; margin: 0; padding: 0;
    }
    .hero {
      background: linear-gradient(135deg, #0f172a, #1e1b4b);
      color: #fff; padding: 28px 24px; margin-bottom: 20px; border-radius: 12px;
    }
    .hero h1 { margin: 0 0 4px; font-size: 28pt; letter-spacing: -0.02em; }
    .hero .sub { color: #c4b5fd; font-size: 13pt; margin: 0 0 12px; }
    .hero .lead { max-width: 820px; margin: 0 0 12px; color: #e2e8f0; }
    .hero .meta { font-size: 9.5pt; color: #94a3b8; }
    .hero a { color: #a5b4fc; }
    .platform {
      border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;
      background: #f8fafc;
    }
    .platform h3 { margin: 0 0 6px; font-size: 11pt; text-transform: uppercase; letter-spacing: .08em; }
    .project { margin: 0 0 24px; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
    .project img { width: 100%; display: block; background: #f3f4f6; }
    .project .body { padding: 14px 16px 16px; }
    .head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    .head h2 { margin: 0; font-size: 16pt; flex: 1 1 auto; }
    .badge {
      background: #7c3aed; color: #fff; font-size: 8pt; font-weight: 700;
      padding: 4px 10px; border-radius: 999px; text-transform: uppercase;
    }
    .url { font-size: 9pt; color: #4f46e5; text-decoration: none; width: 100%; }
    .lead { margin: 0 0 10px; color: #374151; }
    dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; }
    dt { font-weight: 700; color: #6b7280; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; }
    dd { margin: 0; }
    .assistant-banner {
      display: flex; gap: 16px; align-items: flex-start;
      background: #0ea5e9; color: #fff; padding: 20px 16px;
    }
    .assistant-banner h2 { margin: 0 0 6px; color: #fff; }
    .assistant-banner p { margin: 0; color: #e0f2fe; font-size: 10pt; }
    .icon {
      width: 52px; height: 52px; border-radius: 12px; background: rgba(255,255,255,.2);
      display: grid; place-items: center; font-weight: 800; font-size: 14pt; flex-shrink: 0;
    }
    .flow {
      margin-top: 12px; background: #0f172a; color: #e2e8f0; padding: 12px;
      border-radius: 8px; font-size: 9pt; line-height: 1.5; white-space: pre-wrap;
    }
    .section-label {
      font-size: 10pt; text-transform: uppercase; letter-spacing: .12em;
      color: #6b7280; margin: 28px 0 10px; font-weight: 700;
    }
    footer { margin-top: 24px; text-align: center; color: #9ca3af; font-size: 9pt; }
    .page-break { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>
<body>
  <header class="hero">
    <h1>${esc(m.heroTitle)}</h1>
    <p class="sub">${esc(m.heroSub)}</p>
    <p class="lead">${esc(m.heroLead)}</p>
    <p class="meta">${esc(m.author)} · ${esc(m.contacts)}<br />
      <a href="${esc(m.site)}">${esc(m.site)}</a> ·
      <a href="${esc(m.swoop)}">${esc(m.swoop)}</a> ·
      <a href="${esc(m.resume)}">${esc(m.resume)}</a>
    </p>
  </header>

  <section class="platform">
    <h3>${esc(m.platformTitle)}</h3>
    <p style="margin:0">${esc(m.platformStack)}</p>
  </section>

  ${cards}

  <p class="section-label">${esc(m.assistantSection)}</p>
  ${assistant}

  <footer>${esc(m.footer)}</footer>
</body>
</html>`;
}

async function exportPdf(htmlPath, pdfPath) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });
  await browser.close();
  console.log('PDF:', pdfPath);
}

const ruHtml = path.join(ROOT, 'portfolio-ru.html');
const enHtml = path.join(ROOT, 'portfolio-en.html');

fs.writeFileSync(ruHtml, buildHtml('ru'), 'utf8');
fs.writeFileSync(enHtml, buildHtml('en'), 'utf8');
console.log('HTML:', ruHtml, enHtml);

await exportPdf(ruHtml, path.join(ROOT, 'Autoro-Swoop-Portfolio-RU.pdf'));
await exportPdf(enHtml, path.join(ROOT, 'Autoro-Swoop-Portfolio-EN.pdf'));
