const row = Array.isArray($json) ? $json[0] : $json;
const now = new Date().toISOString();

const text = [
  'Сообщение сохранено в память',
  '',
  'Структура:',
  'source: telegram',
  'memory_id: ' + (row?.id || 'n/a'),
  'embedding: ' + ($json.embedding_provider || 'ok'),
  'key_slot: ' + ($json.embedding_key_slot || 'n/a') + ' / ' + ($json.embedding_total_keys || 'n/a'),
  '',
  'Дальше:',
  '1) Сообщение будет учтено в сводках ассистента',
  '2) Можно запросить статус и план следующих шагов',
  '',
  'updated: ' + now,
].join('\n');

// #region agent log
(globalThis.fetch ? fetch('http://127.0.0.1:7321/ingest/c5ff3383-f914-4f0b-b62e-833ca7baf6db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0da90a'},body:JSON.stringify({sessionId:'0da90a',runId:'pre-fix-telegram-md',hypothesisId:'H3',location:'build-structured-confirmation.code.js:19',message:'Built confirmation text for plain mode',data:{hasMarkdownChars:/[*_\[\]()~`>#+\-=|{}.!]/.test(text),textPreview:text.slice(0,220)},timestamp:Date.now()})}) : Promise.resolve()).catch(()=>{});
// #endregion

return [
  {
    ...$json,
    confirmation_text: text,
  },
];
