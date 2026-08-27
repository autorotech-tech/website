/**
 * Unit tests for HH autofill helpers (no browser DOM required for fuzzy match).
 * Run: node extensions/job-responder/content/autofill.test.cjs
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname);
const code = fs.readFileSync(path.join(root, 'autofill.js'), 'utf8');

const listeners = [];
const sandbox = {
  console,
  chrome: {
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
  },
  location: { hostname: 'hh.ru', href: 'https://hh.ru/vacancy/1' },
  Event: class Event {
    constructor(type) {
      this.type = type;
      this.bubbles = true;
    }
  },
  HTMLTextAreaElement: { prototype: {} },
  HTMLInputElement: { prototype: {} },
  document: {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  },
  window: null,
  globalThis: null,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
Object.defineProperty(sandbox.HTMLTextAreaElement.prototype, 'value', {
  set() {},
  get() {
    return '';
  },
  configurable: true,
});
Object.defineProperty(sandbox.HTMLInputElement.prototype, 'value', {
  set() {},
  get() {
    return '';
  },
  configurable: true,
});

vm.runInNewContext(code, sandbox, { filename: 'autofill.js' });
const A = sandbox.__JR_AUTOFILL__;
if (!A) throw new Error('__JR_AUTOFILL__ missing');

if (A.fuzzyMatchScore('Опыт с n8n и Python', 'Опыт работы с n8n') < 0.3) {
  throw new Error('expected fuzzy match for similar RU questions');
}
if (A.fuzzyMatchScore('hello world', 'zzzz unrelated') > 0.2) {
  throw new Error('expected low score for unrelated');
}
if (A.normalizeLabel('«Процесс — результат»') !== '"процесс - результат"') {
  throw new Error('normalizeLabel HH ASCII');
}

const empty = A.fillAnswers([{ question: 'Q', answer: 'A' }]);
if (empty.ok || empty.totalFields !== 0 || !empty.missing.includes('form_fields_not_found')) {
  throw new Error('fillAnswers should no-op when DOM empty');
}
const letterMiss = A.insertLetter('Привет');
if (letterMiss.ok || letterMiss.found || letterMiss.reason !== 'letter_input_not_found') {
  throw new Error('insertLetter should no-op when letter field missing');
}

console.log('autofill helpers ok');
