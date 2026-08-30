// Исправленный код для узла "Build Response"
// Читает formatted_reply от узла "Format Links for Web"

const items = [];

for (const item of $input.all()) {
  // Проверяем все возможные поля с отформатированным ответом
  const reply = item.json.formatted_reply || 
                item.json.original_reply || 
                item.json.output || 
                item.json.answer || 
                '';
  
  items.push({
    json: {
      reply: reply && reply.trim() ? reply : 'Спасибо! Скоро ответим.'
    }
  });
}

return items;

