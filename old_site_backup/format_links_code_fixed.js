// Код для узла "Format Links for Web" 
// Упрощенная и оптимизированная версия

// Получаем ответ от агента
let text = String($json.output || $json.answer || '');

// Если текст пустой, возвращаем дефолт
if (!text || !text.trim()) {
  return [{ 
    json: { 
      formatted_reply: text || 'Спасибо! Скоро ответим.',
      original_reply: $json.output || $json.answer || ''
    } 
  }];
}

// Функция для экранирования HTML (безопасность)
function escapeHtml(str) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

// Сначала экранируем весь текст (кроме уже существующих ссылок)
// Для этого найдем все URL, email, телефоны до экранирования
const urlMatches = [];
const emailMatches = [];
const phoneMatches = [];

// Находим все URL (более простой паттерн)
const urlRegex = /https?:\/\/[^\s<>"']+/gi;
let match;
while ((match = urlRegex.exec(text)) !== null) {
  urlMatches.push({
    placeholder: `__URL_${urlMatches.length}__`,
    original: match[0],
    clean: match[0].replace(/[.,;:!?]+$/, '')
  });
}

// Находим все email
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
while ((match = emailRegex.exec(text)) !== null) {
  emailMatches.push({
    placeholder: `__EMAIL_${emailMatches.length}__`,
    original: match[0]
  });
}

// Находим все телефоны (упрощенный паттерн)
const phoneRegex = /\+?\d[\d\s\-()]{6,}/g;
while ((match = phoneRegex.exec(text)) !== null) {
  const phone = match[0];
  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  phoneMatches.push({
    placeholder: `__PHONE_${phoneMatches.length}__`,
    original: phone,
    clean: cleanPhone
  });
}

// Заменяем найденные элементы на плейсхолдеры
urlMatches.forEach(item => {
  text = text.replace(item.original, item.placeholder);
});
emailMatches.forEach(item => {
  text = text.replace(item.original, item.placeholder);
});
phoneMatches.forEach(item => {
  text = text.replace(item.original, item.placeholder);
});

// Теперь экранируем весь текст
text = escapeHtml(text);

// Заменяем плейсхолдеры обратно на кликабельные ссылки
urlMatches.forEach(item => {
  const escapedClean = escapeHtml(item.clean);
  text = text.replace(item.placeholder, `<a href="${item.clean}" target="_blank" rel="noopener noreferrer">${escapedClean}</a>`);
});
emailMatches.forEach(item => {
  const escapedEmail = escapeHtml(item.original);
  text = text.replace(item.placeholder, `<a href="mailto:${item.original}">${escapedEmail}</a>`);
});
phoneMatches.forEach(item => {
  const escapedPhone = escapeHtml(item.original);
  text = text.replace(item.placeholder, `<a href="tel:${item.clean}">${escapedPhone}</a>`);
});

// Обрабатываем Markdown форматирование (после экранирования, чтобы не сломать ссылки)
// **bold** -> <strong>
text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
// *italic* -> <em> (только если не **)
text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
// `code` -> <code>
text = text.replace(/`([^`]+?)`/g, '<code>$1</code>');

// Обрабатываем переносы строк и списки
text = text.replace(/\n\n+/g, '<br><br>'); // Двойные и более переносы
text = text.replace(/\n/g, '<br>'); // Одинарные переносы
text = text.replace(/<br>\s*•\s*/g, '<br>• '); // Списки с маркерами
text = text.replace(/^\s*•\s*/gm, '• '); // Нормализация маркеров в начале строк

// Финальная чистка
text = text.replace(/\s+/g, ' '); // Множественные пробелы
text = text.replace(/<br>\s*<br>/g, '<br><br>'); // Убираем пробелы между <br>
text = text.trim();

return [{ 
  json: { 
    formatted_reply: text,
    original_reply: $json.output || $json.answer || ''
  } 
}];

