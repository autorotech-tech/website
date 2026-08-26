// ПРОСТОЙ и БЕЗОПАСНЫЙ код для узла "Format response"
// Без попыток получить данные из других узлов

let text = $json.output || $json.answer || '';

// Конвертируем экранированные \n в реальные переносы
if (typeof text === 'string' && text.includes('\\n')) {
  text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

// Убираем мусор
text = text.replace(/\u00A0/g, ' ');
text = text.replace(/\r/g, '');
text = text.replace(/[ \t]+\n/g, '\n');
text = text.replace(/\n{3,}/g, '\n\n');

// Удаляем ЗАПРЕЩЕННЫЕ Telegram HTML теги
text = text.replace(/<\/?p[^>]*>/gi, '\n');
text = text.replace(/<\/?ul[^>]*>/gi, '');
text = text.replace(/<\/?li[^>]*>/gi, '\n• ');
text = text.replace(/<\/?div[^>]*>/gi, '');
text = text.replace(/<\/?span[^>]*>/gi, '');

// Нормализуем списки
text = text.replace(/\n\s*[-–—]\s+/g, '\n• ');
text = text.replace(/\n\s*•\s*/g, '\n• ');

// Финальная чистка
text = text.trim();
text = text.replace(/^\s+|\s+$/gm, '');
text = text.replace(/\n{3,}/g, '\n\n');

// Только форматирование текста, без chat_id
return [{ json: { text: text } }];

