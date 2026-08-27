/**
 * Minimal Node test for platforms registry (no browser).
 * Run: node extensions/job-responder/platforms/registry.test.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = __dirname;
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

function load(name) {
  const code = fs.readFileSync(path.join(root, name), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: name });
}

load('registry.js');
load('hh.js');

const P = sandbox.window.__JR_PLATFORMS__;
if (!P) throw new Error('registry missing');
if (P.hostKey('hh.ru') !== 'ru') throw new Error('hh.ru hostKey');
if (P.hostKey('hh.kz') !== 'kz') throw new Error('hh.kz hostKey');
if (P.detect('remote.co').id !== 'web') throw new Error('t2 detect');
if (P.detect('hh.ru').id !== 'hh') throw new Error('hh detect');
if (!P.isKnownJobSite('getmatch.ru')) throw new Error('known site');
if (P.get('hh').tier !== 1) throw new Error('hh tier');
console.log('platforms registry ok', P.list().map((a) => a.id).join(','));
