import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionKeyForMessage, toLlmMessages } from './telegram/dist/history.js'
import { parseBotIdFromPath } from './telegram/dist/handler.js'

test('private session key is user.id', () => {
  const key = sessionKeyForMessage({
    chat: { id: 111, type: 'private' },
    from: { id: 222 },
  })
  assert.equal(key, '222')
})

test('group session key is chat.id', () => {
  const key = sessionKeyForMessage({
    chat: { id: -100, type: 'supergroup' },
    from: { id: 222 },
  })
  assert.equal(key, '-100')
})

test('toLlmMessages keeps user/assistant order and drops empty', () => {
  const msgs = toLlmMessages([
    { role: 'system', content: 'nope' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: '   ' },
  ])
  assert.deepEqual(msgs, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ])
})

test('parseBotIdFromPath reads webhook and setup aliases', () => {
  const id = '5a298eec-6b34-47ef-9ab1-48e30e6732a7'
  assert.equal(parseBotIdFromPath(`/v1/telegram/webhook/${id}`), id)
  assert.equal(parseBotIdFromPath(`/v1/telegram/setup/${id}/`), id)
  assert.equal(parseBotIdFromPath(`/v1/telegram/status/${id}`), id)
  assert.equal(parseBotIdFromPath('/v1/telegram/webhook/not-a-uuid'), '')
})
