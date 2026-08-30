// Версия с отладкой - проверяет все возможные поля от агента
const items = [];

for (const item of $input.all()) {
  try {
    // Проверяем все возможные поля, где может быть ответ
    const rawText = item.json.output || 
                    item.json.answer || 
                    item.json.text ||
                    item.json.response ||
                    item.json.message ||
                    item.json.content ||
                    (item.json.candidates && item.json.candidates[0] && item.json.candidates[0].content && item.json.candidates[0].content.parts && item.json.candidates[0].content.parts[0] && item.json.candidates[0].content.parts[0].text) ||
                    '';
    
    let text = String(rawText);

    // Логируем для отладки (это будет видно в OUTPUT узла)
    const debugInfo = {
      hasOutput: !!item.json.output,
      hasAnswer: !!item.json.answer,
      hasText: !!item.json.text,
      textLength: text.length,
      first100: text.substring(0, 100),
      allKeys: Object.keys(item.json || {})
    };

    if (!text || !text.trim()) {
      items.push({
        json: {
          formatted_reply: 'Спасибо! Скоро ответим.',
          original_reply: rawText || '',
          _debug: debugInfo
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
        original_reply: rawText || '',
        _debug: debugInfo
      }
    });

  } catch (error) {
    // В случае ошибки возвращаем оригинал с информацией об ошибке
    items.push({
      json: {
        formatted_reply: 'Спасибо! Скоро ответим.',
        original_reply: '',
        _error: error.message,
        _inputKeys: Object.keys(item.json || {})
      }
    });
  }
}

return items.length > 0 ? items : [{ json: { formatted_reply: 'Спасибо! Скоро ответим.', original_reply: '', _empty: true } }];

