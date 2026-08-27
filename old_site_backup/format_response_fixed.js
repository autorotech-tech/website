// Исправленный код для узла "Format response"
// Убрана ссылка на другой узел, который вызывает зависание

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

// ИСПРАВЛЕНО: Используем только данные из текущего узла
// Если chat_id не передан через поток, используем fallback или получаем из предыдущего узла напрямую
const chatId = $json.chat_id || 
               ($input.item.json && $input.item.json.chat_id) || 
               null;

// Возвращаем только text, chat_id будет передан отдельно через узел Set или используется из Extract Message Data
return [{ 
  json: { 
    text: text,
    // Если chat_id есть - сохраняем, если нет - не падаем
    ...(chatId ? { chat_id: chatId } : {})
  } 
}];

