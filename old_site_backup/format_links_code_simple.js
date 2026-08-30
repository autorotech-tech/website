// Код для узла "Format Links for Web" 
// Упрощенная версия без зависаний

try {
  // Получаем ответ от агента
  let text = String($json.output || $json.answer || '');
  
  if (!text || !text.trim()) {
    return [{ 
      json: { 
        formatted_reply: text || 'Спасибо! Скоро ответим.',
        original_reply: $json.output || $json.answer || ''
      } 
    }];
  }

  // Функция для экранирования HTML
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ШАГ 1: Заменяем URL на плейсхолдеры перед экранированием
  const urlPlaceholders = [];
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    const cleanUrl = url.replace(/[.,;:!?]+$/, '');
    const placeholder = `__URL_PLACEHOLDER_${urlPlaceholders.length}__`;
    urlPlaceholders.push({ placeholder, url: cleanUrl });
    return placeholder;
  });

  // ШАГ 2: Заменяем email на плейсхолдеры
  const emailPlaceholders = [];
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, (email) => {
    const placeholder = `__EMAIL_PLACEHOLDER_${emailPlaceholders.length}__`;
    emailPlaceholders.push({ placeholder, email });
    return placeholder;
  });

  // ШАГ 3: Заменяем телефоны на плейсхолдеры
  const phonePlaceholders = [];
  text = text.replace(/(\+?\d[\d\s\-()]{8,})/g, (phone) => {
    const cleanPhone = phone.replace(/[\s\-()]/g, '');
    const placeholder = `__PHONE_PLACEHOLDER_${phonePlaceholders.length}__`;
    phonePlaceholders.push({ placeholder, phone, cleanPhone });
    return placeholder;
  });

  // ШАГ 4: Экранируем весь HTML в тексте
  text = escapeHtml(text);

  // ШАГ 5: Заменяем плейсхолдеры на кликабельные ссылки
  urlPlaceholders.forEach(({ placeholder, url }) => {
    const escapedUrl = escapeHtml(url);
    text = text.replace(placeholder, `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
  });

  emailPlaceholders.forEach(({ placeholder, email }) => {
    const escapedEmail = escapeHtml(email);
    text = text.replace(placeholder, `<a href="mailto:${email}">${escapedEmail}</a>`);
  });

  phonePlaceholders.forEach(({ placeholder, phone, cleanPhone }) => {
    const escapedPhone = escapeHtml(phone);
    text = text.replace(placeholder, `<a href="tel:${cleanPhone}">${escapedPhone}</a>`);
  });

  // ШАГ 6: Markdown форматирование
  // Сначала обрабатываем **bold** (чтобы не перекрыть с *italic*)
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // Потом *italic* (но не внутри **)
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  // И наконец `code`
  text = text.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // ШАГ 7: Переносы строк
  text = text.replace(/\n\n+/g, '<br><br>'); // Двойные переносы
  text = text.replace(/\n/g, '<br>'); // Одинарные переносы

  // ШАГ 8: Нормализация списков
  text = text.replace(/<br>\s*•\s*/g, '<br>• '); // Маркеры списков

  // ШАГ 9: Финальная чистка
  text = text.replace(/\s{2,}/g, ' '); // Множественные пробелы
  text = text.replace(/<br>\s*<br>/g, '<br><br>'); // Убираем пробелы между <br>
  text = text.trim();

  return [{ 
    json: { 
      formatted_reply: text,
      original_reply: $json.output || $json.answer || ''
    } 
  }];

} catch (error) {
  // Если произошла ошибка, возвращаем оригинальный ответ без форматирования
  const original = String($json.output || $json.answer || '');
  return [{ 
    json: { 
      formatted_reply: original.replace(/\n/g, '<br>'),
      original_reply: $json.output || $json.answer || '',
      error: error.message
    } 
  }];
}

