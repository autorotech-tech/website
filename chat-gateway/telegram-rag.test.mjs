import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatKnowledgeBlock, mockGetRagContext } from './telegram/dist/rag.js'

test('formatKnowledgeBlock numbers chunks', () => {
  const text = formatKnowledgeBlock([
    { content: 'price 10', source: 'kb' },
    { content: 'hours 9-18' },
  ])
  assert.match(text, /\[1\] \(kb\)/)
  assert.match(text, /\[2\]/)
  assert.match(text, /price 10/)
})

test('mockGetRagContext returns a test chunk', async () => {
  const rag = await mockGetRagContext('bot-1', 'цена тура')
  assert.equal(rag.source, 'mock')
  assert.equal(rag.degraded, false)
  assert.equal(rag.chunks.length, 1)
})

test('mockGetRagContext empty query is degraded', async () => {
  const rag = await mockGetRagContext('bot-1', '   ')
  assert.equal(rag.degraded, true)
  assert.equal(rag.chunks.length, 0)
})
