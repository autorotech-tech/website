// Код для узла "Format for Telegram" в Telegram workflow
// Разместить между "Multilingual AI Agent" и отправкой в Telegram

// Получаем текст из агента
let text = $json.output || $json.answer || '';

// Шаг 1: Конвертируем экранированные \n в реальные переносы
// Если это строка JSON (экранная), сначала парсим её
if (typeof text === 'string' && text.includes('\\n')) {
  // Заменяем экранированные последовательности на реальные переносы
  text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

// Шаг 2: Убираем мусорные символы
text = text.replace(/\u00A0/g, ' '); // неразрывный пробел → обычный
text = text.replace(/\r/g, ''); // удаляем \r
text = text.replace(/[ \t]+\n/g, '\n'); // пробелы перед переносами
text = text.replace(/\n{3,}/g, '\n\n'); // более 2 переносов → 2

// Шаг 3: Удаляем ЗАПРЕЩЕННЫЕ HTML теги (из Telegram HTML)
// Запрещены: <p>, <ul>, <li>, <div>, <span> и т.д.
text = text.replace(/<\/?p[^>]*>/gi, '\n'); // <p> → перенос
text = text.replace(/<\/?ul[^>]*>/gi, ''); // <ul> удаляем
text = text.replace(/<\/?li[^>]*>/gi, '\n• '); // <li> → маркер списка
text = text.replace(/<\/?div[^>]*>/gi, ''); // <div> удаляем
text = text.replace(/<\/?span[^>]*>/gi, ''); // <span> удаляем

// Шаг 4: Нормализуем списки (разные форматы маркеров → единый)
text = text.replace(/\n\s*[-–—]\s+/g, '\n• ');
text = text.replace(/\n\s*•\s*/g, '\n• ');

// Шаг 5: Очищаем лишние пробелы и переносы
text = text.trim();
text = text.replace(/^\s+|\s+$/gm, ''); // обрезаем пробелы в начале/конце строк
text = text.replace(/\n{3,}/g, '\n\n'); // финальная чистка лишних переносов

// Шаг 6: Проверяем, что разрешенные Telegram HTML теги сохранились
// Разрешенные: <b>, <i>, <u>, <s>, <a href='...'>, <code>, <pre>
// Они должны остаться как есть

// Возвращаем очищенный текст
return [{ json: { text: text } }];

