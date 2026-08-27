// Код для узла "Format Links for Web" 
// Разместить между "Multilingual AI Agent" и "Build Response"

// Получаем ответ от агента
let text = $json.output || $json.answer || '';

// Паттерны для поиска ссылок и контактов
const urlPattern = /(https?:\/\/[^\s<>"']+)/gi;
const phonePattern = /(\+?\d{1,4}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{1,4})/gi;
const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

// Функция для экранирования HTML (безопасность)
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Обрабатываем URL - делаем кликабельными
text = text.replace(urlPattern, (match) => {
  // Убираем пунктуацию в конце URL
  const cleanUrl = match.replace(/[.,;:!?]+$/, '');
  return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
});

// Обрабатываем email - делаем кликабельными
text = text.replace(emailPattern, (email) => {
  return `<a href="mailto:${email}">${email}</a>`;
});

// Обрабатываем телефоны - делаем кликабельными
text = text.replace(phonePattern, (phone) => {
  const cleanPhone = phone.replace(/[\s\-()]/g, ''); // Убираем пробелы и дефисы
  return `<a href="tel:${cleanPhone}">${phone}</a>`;
});

// Обрабатываем Markdown форматирование
text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // **bold**
text = text.replace(/\*(.*?)\*/g, '<em>$1</em>'); // *italic*
text = text.replace(/`(.*?)`/g, '<code>$1</code>'); // `code`

// Обрабатываем списки (маркеры)
text = text.replace(/^[\s]*•[\s]+/gm, '• '); // Нормализуем маркеры
text = text.replace(/\n• /g, '<br>• '); // Перенос строки перед маркером

// Обрабатываем переносы строк
text = text.replace(/\n\n/g, '<br><br>'); // Двойной перенос
text = text.replace(/\n/g, '<br>'); // Одинарный перенос

// Безопасность: экранируем весь текст, кроме уже созданных тегов
const parts = text.split(/(<[^>]+>)/g);
text = parts.map(part => {
  if (part.startsWith('<') && part.endsWith('>')) {
    return part; // Это HTML тег, оставляем как есть
  }
  return escapeHtml(part); // Экранируем текст
}).join('');

// Убираем лишние пробелы
text = text.replace(/[ \t]+/g, ' ');
text = text.trim();

return [{ 
  json: { 
    formatted_reply: text,
    original_reply: $json.output || $json.answer
  } 
}];

