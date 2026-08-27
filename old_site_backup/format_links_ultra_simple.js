// Ультра-простая версия - только переносы строк и базовые ссылки
// Без сложных операций

let text = String($json.output || $json.answer || '');

if (!text || !text.trim()) {
  return [{ 
    json: { 
      formatted_reply: 'Спасибо! Скоро ответим.',
      original_reply: text
    } 
  }];
}

// Экранируем HTML
text = text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Очень простая замена URL (только http/https)
text = text.replace(/(https?:\/\/[^\s<>"']+)/gi, (url) => {
  const clean = url.replace(/[.,;:!?]+$/, '');
  return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>`;
});

// Но после экранирования ссылки сломались, нужно восстановить
// Просто делаем это в два прохода - сначала ссылки, потом экранирование
let text2 = String($json.output || $json.answer || '');

// Простое экранирование без амперсандов (чтобы не сломать ссылки)
text2 = text2.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Заменяем URL
text2 = text2.replace(/(https?:\/\/[^\s<>"']+)/gi, (url) => {
  const clean = url.replace(/[.,;:!?]+$/, '');
  const display = clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${display}</a>`;
});

// Markdown
text2 = text2.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

// Переносы строк
text2 = text2.replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');

return [{ 
  json: { 
    formatted_reply: text2.trim(),
    original_reply: $json.output || $json.answer || ''
  } 
}];

