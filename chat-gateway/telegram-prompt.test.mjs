import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SALES_SYSTEM_PROMPT,
  SUPPORT_SYSTEM_PROMPT,
  buildTenantSystemPrompt,
  classifyIntent,
  fallbackReply,
  resolveRolePrompt,
  systemPromptForRole,
  wrapKnowledgeBase,
} from './telegram/dist/prompt.js'

test('sales role uses consultative RAG prompt', () => {
  const p = systemPromptForRole('sales')
  assert.equal(p, SALES_SYSTEM_PROMPT)
  assert.match(p, /TENANT ISOLATION/)
  assert.match(p, /CONSULTATIVE SELLING/)
  assert.match(p, /RAG GUARDRAILS/)
  assert.match(p, /Soft CTA/)
  assert.match(p, /надежный советник/)
  assert.doesNotMatch(p, /t\.me\/pquoc/)
  assert.doesNotMatch(p, /pquoc\.com/)
})

test('support role has no sales funnel CTA', () => {
  const p = systemPromptForRole('support')
  assert.equal(p, SUPPORT_SYSTEM_PROMPT)
  assert.doesNotMatch(p, /t\.me\/pquoc/)
  assert.match(p, /No sales funnel/)
})

test('resolveRolePrompt prefers admin override', () => {
  assert.equal(resolveRolePrompt('sales', '  custom sales  '), 'custom sales')
  assert.equal(resolveRolePrompt('support', ''), SUPPORT_SYSTEM_PROMPT)
  assert.equal(resolveRolePrompt('sales', null), SALES_SYSTEM_PROMPT)
})

test('classifyIntent matches AskPQuoc flow', () => {
  assert.equal(classifyIntent('привет'), 'smalltalk')
  assert.equal(classifyIntent('hello!'), 'smalltalk')
  assert.equal(classifyIntent('wedding on Phu Quoc'), 'advice')
  assert.equal(classifyIntent('сколько стоит тур'), 'quote')
  assert.equal(classifyIntent('what is the price'), 'quote')
  assert.equal(classifyIntent('позовите менеджера'), 'human')
  assert.equal(classifyIntent('какие пляжи на севере'), 'faq')
})

test('buildTenantSystemPrompt skips KB on smalltalk', () => {
  const system = buildTenantSystemPrompt({
    basePrompt: SALES_SYSTEM_PROMPT,
    role: 'sales',
    lang: 'ru',
    intent: 'smalltalk',
    knowledge: 'secret tenant fact',
    degraded: false,
    skipKbGrounding: true,
  })
  assert.match(system, /greeting/)
  assert.doesNotMatch(system, /secret tenant fact/)
  assert.match(system, /ROLE: sales/)
  assert.match(system, /consultative advisor/)
})

test('buildTenantSystemPrompt injects tenant KB and support overlay', () => {
  const system = buildTenantSystemPrompt({
    basePrompt: SUPPORT_SYSTEM_PROMPT,
    role: 'support',
    lang: 'en',
    intent: 'faq',
    knowledge: 'Hotel X is on Ong Lang',
    degraded: false,
    skipKbGrounding: false,
  })
  assert.match(system, /Hotel X is on Ong Lang/)
  assert.match(system, /this tenant chat agent only/)
  assert.match(system, /ROLE: support/)
  assert.match(system, /detected_language: en/)
})

test('wrapKnowledgeBase marks degraded empty KB', () => {
  const wrapped = wrapKnowledgeBase('', true)
  assert.match(wrapped, /<knowledge_base>/)
  assert.match(wrapped, /недоступна/)
})

test('fallbackReply is ru/en aware', () => {
  assert.match(fallbackReply('ru'), /менеджеру/)
  assert.match(fallbackReply('en'), /manager/i)
})
