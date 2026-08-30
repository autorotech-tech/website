import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldReplyToTelegramMessage, stripBotMentions } from './telegram/dist/addressing.js'

const bot = { id: '111', username: 'AskPQuoc_bot' }

test('private chats always get a reply', () => {
  assert.equal(
    shouldReplyToTelegramMessage({ chat: { type: 'private' }, text: 'hi' }, bot),
    true,
  )
})

test('unaddressed group job offer is ignored', () => {
  const msg = {
    chat: { type: 'supergroup' },
    text: 'есть несложное дело, плачу 10к в день. интересно - пиши',
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), false)
})

test('group @AskPQuoc_bot mention is addressed', () => {
  const msg = {
    chat: { type: 'supergroup' },
    text: '@AskPQuoc_bot какие пляжи на Фукуоке?',
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), true)
})

test('group @AskPQuoc mention is addressed', () => {
  const msg = {
    chat: { type: 'group' },
    text: 'привет @AskPQuoc подскажи визу',
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), true)
})

test('reply to bot message is addressed', () => {
  const msg = {
    chat: { type: 'supergroup' },
    text: 'а какой пляж лучше?',
    reply_to_message: { from: { is_bot: true, id: 111, username: 'AskPQuoc_bot' } },
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), true)
})

test('reply to another user is ignored', () => {
  const msg = {
    chat: { type: 'supergroup' },
    text: 'согласен',
    reply_to_message: { from: { is_bot: false, id: 999, username: 'yulia' } },
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), false)
})

test('/start@AskPQuoc_bot in group is addressed', () => {
  const text = '/start@AskPQuoc_bot'
  const msg = {
    chat: { type: 'supergroup' },
    text,
    entities: [{ type: 'bot_command', offset: 0, length: text.length }],
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), true)
})

test('bare /start in group is ignored', () => {
  const msg = {
    chat: { type: 'supergroup' },
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  }
  assert.equal(shouldReplyToTelegramMessage(msg, bot), false)
})

test('channel posts are ignored', () => {
  assert.equal(
    shouldReplyToTelegramMessage({ chat: { type: 'channel' }, text: '@AskPQuoc_bot hi' }, bot),
    false,
  )
})

test('stripBotMentions removes @username for RAG query', () => {
  assert.equal(stripBotMentions('@AskPQuoc_bot какая цена?', bot), 'какая цена?')
})

test('generic sales bot does not reply to AskPQuoc mention', () => {
  const salesBot = { id: '999', username: 'AutoroSales_bot' }
  const msg = {
    chat: { type: 'supergroup' },
    text: '@AskPQuoc_bot какие пляжи на Фукуоке?',
  }
  assert.equal(shouldReplyToTelegramMessage(msg, salesBot), false)
})

test('generic sales bot replies to its own mention', () => {
  const salesBot = { id: '999', username: 'AutoroSales_bot' }
  const msg = {
    chat: { type: 'supergroup' },
    text: '@AutoroSales_bot сколько стоит аудит?',
  }
  assert.equal(shouldReplyToTelegramMessage(msg, salesBot), true)
})
