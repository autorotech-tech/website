#!/usr/bin/env node
/**
 * Встраивает актуальный код из detect-run-command.code.js в узел
 * «Detect & Run Command» файла telegram_personal_assistant_memory.json
 * (n8n не подхватывает внешний .js автоматически).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const wfPath = path.join(root, 'n8n/workflows/telegram_personal_assistant_memory.json');
const detectPath = path.join(root, 'n8n/workflows/detect-run-command.code.js');
const vectorizePath = path.join(root, 'n8n/workflows/vectorize-with-key-rotation.code.js');
const applyHermesPath = path.join(root, 'n8n/workflows/apply-hermes-answer.code.js');

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

function embedCode(nodeName, filePath) {
  const node = wf.nodes.find((n) => n && n.name === nodeName);
  if (!node) {
    console.error(`Node "${nodeName}" not found`);
    process.exit(2);
  }
  node.parameters = node.parameters || {};
  node.parameters.jsCode = fs.readFileSync(filePath, 'utf8');
}

embedCode('Detect & Run Command', detectPath);
embedCode('Vectorize With Key Rotation', vectorizePath);
embedCode('Apply Hermes Answer', applyHermesPath);
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
console.log('OK:', wfPath);
