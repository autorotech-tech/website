import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textToMarkdown } from './pdfMarkdown.mjs'

test('textToMarkdown wraps title and paragraphs without LLM', () => {
  const md = textToMarkdown('Hello world.\n\nSecond paragraph.', 'Offer.pdf')
  assert.match(md, /^# Offer\.pdf\n/)
  assert.match(md, /Hello world\./)
  assert.match(md, /Second paragraph\./)
})

test('textToMarkdown turns ALL-CAPS lines into headings', () => {
  const md = textToMarkdown('SERVICES\nWe automate workflows.', 'kb')
  assert.match(md, /^## SERVICES$/m)
  assert.match(md, /We automate workflows\./)
})
