import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SALES_SYSTEM_PROMPT, SUPPORT_SYSTEM_PROMPT, fallbackReply, systemPromptForRole, wrapKnowledgeBase } from './telegram/dist/prompt.js'

test('sales role uses CTA sales prompt', () => {
  const p = systemPromptForRole('sales')
  assert.equal(p, SALES_SYSTEM_PROMPT)
  assert.match(p, /Call-to-Action/)
  assert.match(p, /LANGUAGE/)
})

test('support role has no sales funnel', () => {
  const p = systemPromptForRole('support')
  assert.equal(p, SUPPORT_SYSTEM_PROMPT)
  assert.doesNotMatch(p, /Call-to-Action/)
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
