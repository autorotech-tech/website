const originalText = String($json.text || '').trim();

function compactWhitespace(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.;:!?])\s*/g, '$1 ')
    .replace(/\s+$/g, '')
    .trim();
}

function normalizeVoiceNoise(text) {
  return compactWhitespace(text)
    .replace(/^(ну|короче|так|типа|значит)\s+/i, '')
    .replace(/\bпожалуйста\b/gi, '')
    .trim();
}

function detectKind(text) {
  const t = text.toLowerCase();

  const taskSignals = ['сделать', 'сделай', 'нужно', 'надо', 'задача', 'дедлайн', 'срок', 'todo', 'to do', 'выполни'];
  const planSignals = ['план', 'этап', 'дорожн', 'roadmap', 'шаг', 'стратег'];
  const ideaSignals = ['идея', 'гипотез', 'можно', 'предлагаю', 'концепц'];
  const instructionSignals = ['инструкция', 'как', 'гайд', 'manual', 'шаблон', 'правило'];
  const researchSignals = ['исследуй', 'ресерч', 'research', 'проанализируй', 'сравни'];

  if (researchSignals.some((k) => t.includes(k))) return 'research';
  if (taskSignals.some((k) => t.includes(k))) return 'task';
  if (planSignals.some((k) => t.includes(k))) return 'plan';
  if (ideaSignals.some((k) => t.includes(k))) return 'idea';
  if (instructionSignals.some((k) => t.includes(k))) return 'instruction';
  return 'idea';
}

function extractTopic(text) {
  const stop = new Set([
    'и','в','во','на','по','для','как','что','это','этот','эта','или','а','но','к','ко','с','со','из','у','о','об','про','нужно','надо','сделать','сделай','план','идея','задача','давай','хочу','надо'
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w));

  const uniq = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= 4) break;
  }

  return uniq.length ? uniq.join(' / ') : 'общий контекст';
}

function shortSentences(text, max = 3) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => compactWhitespace(s))
    .filter(Boolean)
    .slice(0, max);
}

function normalize(kind, text, topic) {
  const clean = normalizeVoiceNoise(text);
  const chunks = shortSentences(clean, 3);
  const body = chunks.join(' ');

  switch (kind) {
    case 'research':
      return `Ресерч: ${body || clean}.\nФокус: ${topic}.`;
    case 'task':
      return `Задача: ${body || clean}.\nКонтекст: ${topic}.`;
    case 'plan':
      return `План: ${body || clean}.\nФокус: ${topic}.`;
    case 'instruction':
      return `Инструкция: ${body || clean}.\nКонтекст: ${topic}.`;
    case 'idea':
    default:
      return `Идея: ${body || clean}.\nЦенность: ${topic}.`;
  }
}

function resolveObsidianBranch(kind) {
  switch (kind) {
    case 'task':
      return 'Inbox/Tasks';
    case 'plan':
      return 'Inbox/Plans';
    case 'instruction':
      return 'Inbox/Instructions';
    case 'research':
      return 'Inbox/Research';
    case 'idea':
    default:
      return 'Inbox/Ideas';
  }
}

const memory_kind = detectKind(originalText);
const memory_topic = extractTopic(originalText);
const normalized_text = normalize(memory_kind, originalText, memory_topic);
const obsidian_branch = resolveObsidianBranch(memory_kind);
const obsidian_note_path = `${obsidian_branch}/${new Date().toISOString().slice(0,10)}-${memory_topic.replace(/\s*\/\s*/g,'-').replace(/[^\p{L}\p{N}-]/gu,'').slice(0,60) || 'general'}.md`;

return [
  {
    ...$json,
    original_text: originalText,
    memory_kind,
    memory_topic,
    normalized_text,
    obsidian_branch,
    obsidian_note_path,
    text: normalized_text,
  },
];
