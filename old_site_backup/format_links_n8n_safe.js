// Безопасная версия для n8n - обрабатывает все входные элементы
// Используйте этот код в узле "Format Links for Web"

const items = [];

for (const item of $input.all()) {
  try {
    let text = String(item.json.output || item.json.answer || '');

    if (!text || !text.trim()) {
      items.push({
        json: {
          formatted_reply: 'Спасибо! Скоро ответим.',
          original_reply: item.json.output || item.json.answer || ''
        }
      });
      continue;
    }

    // ШАГ 1: Заменяем URL на плейсхолдеры
    const urlMatches = [];
    text = text.replace(/(https?:\/\/[^\s<>"']+)/gi, (match) => {
      const cleanUrl = match.replace(/[.,;:!?]+$/, '');
      const placeholder = `__URL__${urlMatches.length}__`;
      urlMatches.push({ placeholder, url: cleanUrl });
      return placeholder;
    });

    // ШАГ 2: Экранируем HTML
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // ШАГ 3: Заменяем плейсхолдеры на ссылки
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

    // ШАГ 4: Markdown
    text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

    // ШАГ 5: Переносы строк
    text = text.replace(/\n\n+/g, '<br><br>');
    text = text.replace(/\n/g, '<br>');

    // ШАГ 6: Списки
    text = text.replace(/<br>\s*•\s*/g, '<br>• ');
    text = text.trim();

    items.push({
      json: {
        formatted_reply: text || '',
        original_reply: item.json.output || item.json.answer || ''
      }
    });

  } catch (error) {
    // В случае ошибки возвращаем оригинал
    const original = String(item.json.output || item.json.answer || '');
    items.push({
      json: {
        formatted_reply: original.replace(/\n/g, '<br>') || 'Спасибо! Скоро ответим.',
        original_reply: item.json.output || item.json.answer || ''
      }
    });
  }
}

// Всегда возвращаем массив
return items.length > 0 ? items : [{ json: { formatted_reply: 'Спасибо! Скоро ответим.', original_reply: '' } }];

