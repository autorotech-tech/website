#!/usr/bin/env node
/**
 * Generates config/n8n-autoro-site-chat.json — site chat + Telegram operator relay.
 * No Code nodes (works without external task runners).
 * Run: node scripts/generate-n8n-autoro-site-chat.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'config', 'n8n-autoro-site-chat.json');

const workflow = [{
  id: 'A1b2c3d4-e5f6-7890-abcd-autoro000001',
  name: 'Site Chat (autoro.tech)',
  active: true,
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'autoro/chat/site', responseMode: 'responseNode', options: {} },
      id: 'wh-autoro-site',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2.1,
      position: [240, 400],
      webhookId: 'autoro-chat-site-wh',
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: 'text',
              name: 'text',
              value: "={{ ($json.body?.message || $json.message || $json.text || '').toString().slice(0, 2000) }}",
              type: 'string',
            },
            {
              id: 'session',
              name: 'session',
              value: "={{ ($json.body?.session || $json.session || $json.session_id || '').toString().slice(0, 80) }}",
              type: 'string',
            },
            {
              id: 'session_id',
              name: 'session_id',
              value: "={{ ($json.body?.session || $json.session || $json.session_id || '').toString().slice(0, 80) }}",
              type: 'string',
            },
            {
              id: 'platform',
              name: 'platform',
              value: "={{ ($json.body?.platform || $json.platform || 'site').toString().toLowerCase().slice(0, 16) }}",
              type: 'string',
            },
            {
              id: 'bot_id',
              name: 'bot_id',
              value: "={{ ($json.body?.bot_id || $json.bot_id || '').toString().trim() }}",
              type: 'string',
            },
            {
              id: 'lang',
              name: 'lang',
              value: "={{ ($json.body?.lang || $json.lang || $json.detected_language || 'en').toString().slice(0, 2) }}",
              type: 'string',
            },
            {
              id: 'detected_language',
              name: 'detected_language',
              value: "={{ ($json.body?.lang || $json.lang || $json.detected_language || 'en').toString().slice(0, 2) }}",
              type: 'string',
            },
            {
              id: 'page_url',
              name: 'page_url',
              value: "={{ ($json.body?.page_url || $json.page_url || '').toString().slice(0, 500) }}",
              type: 'string',
            },
            {
              id: 'reply_to_text',
              name: 'reply_to_text',
              value: "={{ ($json.body?.reply_to_text || $json.reply_to_text || $json.reply_to_message?.text || '').toString().slice(0, 4000) }}",
              type: 'string',
            },
            {
              id: 'telegram_chat_id',
              name: 'telegram_chat_id',
              value: "={{ ($json.body?.telegram_chat_id || $json.telegram_chat_id || $json.body?.chat_id || $json.chat_id || $json.body?.session_id || $json.session_id || '').toString().slice(0, 32) }}",
              type: 'string',
            },
            {
              id: 'chat_id',
              name: 'chat_id',
              value: "={{ (($json.body?.platform || $json.platform || 'site').toString().toLowerCase() === 'telegram') ? ($json.body?.session_id || $json.session_id || $json.chat_id || '').toString().slice(0, 80) : ('site:' + ($json.body?.session || $json.session || $json.session_id || 'anon').toString().slice(0, 80)) }}",
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: 'norm-autoro',
      name: 'Normalize Input',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [460, 400],
    },
    {
      parameters: {
        rules: {
          values: [{
            conditions: {
              options: { caseSensitive: false, typeValidation: 'strict', version: 2 },
              conditions: [{
                id: 'p-site',
                leftValue: '={{ $json.platform }}',
                rightValue: 'site',
                operator: { type: 'string', operation: 'equals' },
              }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'site',
          }],
        },
        options: { fallbackOutput: 'extra', fallbackOutputName: 'telegram' },
      },
      id: 'sw-platform',
      name: 'Route Platform',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [680, 400],
    },
    {
      parameters: {
        assignments: {
          assignments: [{
            id: 'admin_chat_id',
            name: 'admin_chat_id',
            value: "={{ ($env.AUTORO_TELEGRAM_ADMIN_CHAT_ID || $env.TELEGRAM_CHAT_ID || '').toString().trim() }}",
            type: 'string',
          }],
        },
        options: {},
      },
      id: 'resolve-admin',
      name: 'Resolve Admin Chat',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [920, 280],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'has-admin',
            leftValue: '={{ $json.admin_chat_id }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-admin-chat',
      name: 'Has Admin Chat?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1140, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [{
            id: 'telegram_notify',
            name: 'telegram_notify',
            value: "={{ (() => { const j = $('Normalize Input').item.json; const lines = ['🌐 autoro.tech — новое сообщение', '#SID:' + (j.session || ''), 'Lang: ' + (j.lang || 'en'), j.page_url ? 'Page: ' + j.page_url : '', '---', j.text || '', '---', 'Ответьте reply на это сообщение, чтобы отправить ответ пользователю в чат на сайте.'].filter(Boolean); return lines.join('\\n').slice(0, 4000); })() }}",
            type: 'string',
          }],
        },
        options: {},
      },
      id: 'build-notify',
      name: 'Build Telegram Notify',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1360, 220],
    },
    {
      parameters: {
        method: 'POST',
        url: '=https://api.telegram.org/bot{{ $env.AUTORO_TELEGRAM_BOT_TOKEN }}/sendMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={\n  "chat_id": {{ JSON.stringify($(\'Resolve Admin Chat\').item.json.admin_chat_id || $env.AUTORO_TELEGRAM_ADMIN_CHAT_ID || "") }},\n  "text": {{ JSON.stringify($(\'Build Telegram Notify\').item.json.telegram_notify) }},\n  "disable_web_page_preview": true\n}',
        options: {},
      },
      id: 'tg-notify-admin',
      name: 'Notify Admin Telegram',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1580, 220],
    },
    {
      parameters: {
        assignments: {
          assignments: [{
            id: 'reply',
            name: 'reply',
            value: "={{ ($('Normalize Input').item.json.lang === 'ru' ? 'Спасибо! Мы получили сообщение. Специалист Autoro скоро ответит здесь.' : 'Thanks! We received your message. An Autoro specialist will reply here shortly.') }}",
            type: 'string',
          }],
        },
        options: {},
      },
      id: 'build-ack',
      name: 'Build Site Ack',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1800, 280],
    },
    {
      parameters: { respondWith: 'json', responseBody: '={{ { reply: $json.reply } }}', options: {} },
      id: 'respond-site',
      name: 'Respond Site',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [2020, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: 'operator_session',
              name: 'operator_session',
              value: "={{ (() => { const rt = String($json.reply_to_text || ''); const m1 = rt.match(/#SID:([0-9a-f-]{8,36})/i); if (m1) return m1[1]; const t = String($json.text || '').trim(); const m2 = t.match(/^\\/reply\\s+([0-9a-f-]{8,36})\\s+([\\s\\S]+)$/i); return m2 ? m2[1] : ''; })() }}",
              type: 'string',
            },
            {
              id: 'operator_reply',
              name: 'operator_reply',
              value: "={{ (() => { const t = String($json.text || '').trim(); const cmd = t.match(/^\\/reply\\s+([0-9a-f-]{8,36})\\s+([\\s\\S]+)$/i); if (cmd) return cmd[2].trim(); return t; })() }}",
              type: 'string',
            },
            {
              id: 'has_operator_reply',
              name: 'has_operator_reply',
              value: "={{ (() => { const rt = String($json.reply_to_text || ''); const sid = (rt.match(/#SID:([0-9a-f-]{8,36})/i) || [])[1] || (String($json.text || '').trim().match(/^\\/reply\\s+([0-9a-f-]{8,36})\\s+([\\s\\S]+)$/i) || [])[1] || ''; const reply = (() => { const t = String($json.text || '').trim(); const cmd = t.match(/^\\/reply\\s+([0-9a-f-]{8,36})\\s+([\\s\\S]+)$/i); return cmd ? cmd[2].trim() : t; })(); return Boolean(sid && reply); })() }}",
              type: 'boolean',
            },
          ],
        },
        options: {},
      },
      id: 'parse-operator',
      name: 'Parse Operator Reply',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [920, 520],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'has-reply',
            leftValue: '={{ $json.has_operator_reply }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-operator',
      name: 'Has Operator Reply?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1140, 520],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://autoro-chat-gateway:8080/v1/chat-agent/push-reply',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={\n  "bot_id": {{ JSON.stringify($(\'Parse Operator Reply\').item.json.bot_id) }},\n  "session_id": {{ JSON.stringify($(\'Parse Operator Reply\').item.json.operator_session) }},\n  "reply": {{ JSON.stringify($(\'Parse Operator Reply\').item.json.operator_reply) }},\n  "secret": {{ JSON.stringify($env.CHAT_PUSH_SECRET || $env.N8N_SHARED_SECRET || "") }}\n}',
        options: {},
      },
      id: 'push-reply-gw',
      name: 'Push Reply to Gateway',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1360, 480],
    },
    {
      parameters: {
        method: 'POST',
        url: '=https://api.telegram.org/bot{{ $env.AUTORO_TELEGRAM_BOT_TOKEN }}/sendMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={\n  "chat_id": {{ JSON.stringify($(\'Parse Operator Reply\').item.json.telegram_chat_id || $(\'Parse Operator Reply\').item.json.chat_id) }},\n  "text": "✅ Ответ отправлен пользователю на сайте."\n}',
        options: {},
      },
      id: 'tg-confirm',
      name: 'Confirm Operator',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1580, 480],
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
    'Normalize Input': { main: [[{ node: 'Route Platform', type: 'main', index: 0 }]] },
    'Route Platform': {
      main: [
        [{ node: 'Resolve Admin Chat', type: 'main', index: 0 }],
        [{ node: 'Parse Operator Reply', type: 'main', index: 0 }],
      ],
    },
    'Resolve Admin Chat': { main: [[{ node: 'Has Admin Chat?', type: 'main', index: 0 }]] },
    'Has Admin Chat?': {
      main: [
        [{ node: 'Build Telegram Notify', type: 'main', index: 0 }],
        [{ node: 'Build Site Ack', type: 'main', index: 0 }],
      ],
    },
    'Build Telegram Notify': { main: [[{ node: 'Notify Admin Telegram', type: 'main', index: 0 }]] },
    'Notify Admin Telegram': { main: [[{ node: 'Build Site Ack', type: 'main', index: 0 }]] },
    'Build Site Ack': { main: [[{ node: 'Respond Site', type: 'main', index: 0 }]] },
    'Parse Operator Reply': { main: [[{ node: 'Has Operator Reply?', type: 'main', index: 0 }]] },
    'Has Operator Reply?': {
      main: [
        [{ node: 'Push Reply to Gateway', type: 'main', index: 0 }],
        [],
      ],
    },
    'Push Reply to Gateway': { main: [[{ node: 'Confirm Operator', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
}];

fs.writeFileSync(OUT, JSON.stringify(workflow, null, 2));
console.log('Wrote', OUT, '(no Code nodes)');
