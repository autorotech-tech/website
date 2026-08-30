// Обновленная версия - сохраняет язык для дальнейшей передачи
const items = [];

for (const item of $input.all()) {
  try {
    // Читаем ответ от агента
    const text = String(item.json.output || item.json.answer || '');

    if (!text || !text.trim()) {
      items.push({
        json: {
          formatted_reply: 'Спасибо! Скоро ответим.',
          original_reply: '',
          detected_language: item.json.detected_language || item.json.lang || 'en'
        }
      });
      continue;
    }

    // Сохраняем язык из входных данных
    const lang = item.json.detected_language || item.json.lang || 'en';
    
    // ШАГ 1: Сначала обрабатываем списки (маркеры) - заменяем * на •
    let processed = text.replace(/^\s*\*\s+/gm, '• ');

    // ШАГ 2: Заменяем URL на плейсхолдеры ДО экранирования
    const urlMatches = [];
    processed = processed.replace(/(https?:\/\/[^\s<>"']+)/gi, (match) => {
      const cleanUrl = match.replace(/[.,;:!?]+$/, '');
      const placeholder = `__URL__${urlMatches.length}__`;
      urlMatches.push({ placeholder, url: cleanUrl });
      return placeholder;
    });

    // ШАГ 3: Экранируем HTML (но плейсхолдеры останутся)
    processed = processed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // ШАГ 4: Заменяем плейсхолдеры на кликабельные ссылки
    if (urlMatches.length > 0) {
      urlMatches.forEach(({ placeholder, url }) => {
        const escapedUrl = url
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        processed = processed.replace(placeholder, `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
      });
    }

    // ШАГ 5: Markdown форматирование (**bold**)
    processed = processed.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

    // ШАГ 6: Переносы строк
    processed = processed.replace(/\n\n+/g, '<br><br>');
    processed = processed.replace(/\n/g, '<br>');

    // ШАГ 7: Нормализация списков
    processed = processed.replace(/<br>\s*•\s*/g, '<br>• ');
    processed = processed.trim();

    items.push({
      json: {
        formatted_reply: processed || text.replace(/\n/g, '<br>'),
        original_reply: text,
        detected_language: lang // Передаем язык дальше
      }
    });

  } catch (error) {
    const original = String(item.json.output || item.json.answer || '');
    items.push({
      json: {
        formatted_reply: original.replace(/\n/g, '<br>') || 'Спасибо! Скоро ответим.',
        original_reply: original,
        detected_language: item.json.detected_language || item.json.lang || 'en',
        _error: error.message
      }
    });
  }
}

return items.length > 0 ? items : [{ json: { formatted_reply: 'Спасибо! Скоро ответим.', original_reply: '', detected_language: 'en' } }];

