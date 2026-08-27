// Исправленная версия - всегда возвращает массив
// Используйте этот код в узле "Format Links for Web"

try {
  let text = String($json.output || $json.answer || '');

  if (!text || !text.trim()) {
    return [{ 
      json: { 
        formatted_reply: 'Спасибо! Скоро ответим.',
        original_reply: $json.output || $json.answer || ''
      } 
    }];
  }

  // ШАГ 1: Заменяем URL на плейсхолдеры ДО экранирования
  const urlMatches = [];
  text = text.replace(/(https?:\/\/[^\s<>"']+)/gi, (match) => {
    const cleanUrl = match.replace(/[.,;:!?]+$/, '');
    const placeholder = `__URL__${urlMatches.length}__`;
    urlMatches.push({ placeholder, url: cleanUrl, original: match });
    return placeholder;
  });

  // ШАГ 2: Экранируем HTML (но плейсхолдеры останутся нетронутыми)
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // ШАГ 3: Заменяем плейсхолдеры на кликабельные ссылки
  if (urlMatches.length > 0) {
    urlMatches.forEach(({ placeholder, url }) => {
      const escapedUrl = url
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      text = text.replace(placeholder, `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
    });
  }

  // ШАГ 4: Markdown форматирование (**bold**)
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

  // ШАГ 5: Переносы строк
  text = text.replace(/\n\n+/g, '<br><br>');
  text = text.replace(/\n/g, '<br>');

  // ШАГ 6: Нормализация списков (маркеры)
  text = text.replace(/<br>\s*•\s*/g, '<br>• ');
  text = text.replace(/^\s*•\s*/gm, '• ');

  // Финальная чистка
  text = text.trim();

  // ВАЖНО: всегда возвращаем массив с объектом json
  return [{ 
    json: { 
      formatted_reply: text || '',
      original_reply: $json.output || $json.answer || ''
    } 
  }];

} catch (error) {
  // В случае ошибки также возвращаем массив
  const original = String($json.output || $json.answer || '');
  return [{ 
    json: { 
      formatted_reply: original.replace(/\n/g, '<br>') || 'Спасибо! Скоро ответим.',
      original_reply: $json.output || $json.answer || '',
      _error: error.message
    } 
  }];
}

