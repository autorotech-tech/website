// Минимальная версия - только базовое форматирование
// Без сложных регулярных выражений

try {
  let text = String($json.output || $json.answer || '');
  
  if (!text || !text.trim()) {
    return [{ 
      json: { 
        formatted_reply: text || 'Спасибо! Скоро ответим.',
        original_reply: $json.output || $json.answer || ''
      } 
    }];
  }

  // Простое экранирование HTML
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Находим и заменяем URL (самый простой способ)
  const lines = text.split('\n');
  const processedLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Обрабатываем URL
    const urlMatch = line.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      const url = urlMatch[1].replace(/[.,;:!?]+$/, '');
      const escapedUrl = escapeHtml(url);
      line = line.replace(urlMatch[1], `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
    }
    
    // Экранируем остальной текст
    line = escapeHtml(line);
    
    // Восстанавливаем ссылки (они уже экранированы в href, но нужно восстановить текст)
    line = line.replace(/&lt;a href="([^"]+)"[^&]*&gt;([^&]+)&lt;\/a&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
    
    processedLines.push(line);
  }
  
  text = processedLines.join('<br>');
  
  // Простое форматирование Markdown
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  
  return [{ 
    json: { 
      formatted_reply: text,
      original_reply: $json.output || $json.answer || ''
    } 
  }];

} catch (error) {
  // При ошибке возвращаем оригинал с простой заменой переносов
  const original = String($json.output || $json.answer || '');
  return [{ 
    json: { 
      formatted_reply: original.replace(/\n/g, '<br>'),
      original_reply: $json.output || $json.answer || ''
    } 
  }];
}

