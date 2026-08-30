#!/usr/bin/env node
/**
 * Готовит тело для PUT /api/v1/workflows/:id из экспортного JSON n8n.
 * Usage: node prepare-workflow-api-payload.cjs path/to/workflow.json > payload.json
 */
const fs = require('fs');

const wfPath = process.argv[2];
if (!wfPath) {
  console.error('Usage: node prepare-workflow-api-payload.cjs <workflow.json>');
  process.exit(2);
}

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || { executionOrder: 'v1' },
};

if (wf.staticData != null) {
  payload.staticData = wf.staticData;
}

process.stdout.write(JSON.stringify(payload));
