// Обновленный код для узла "Build Response"
// Ограничивает длину ответа и добавляет финальную фразу на языке пользователя

const items = [];

// Финальные фразы на разных языках
const finalPhrases = {
  ru: 'За подробной информацией планирования идеального отдыха, вы можете обратиться к гиду.',
  en: 'For detailed information about planning your perfect vacation, you can contact the guide.',
  es: 'Para obtener información detallada sobre la planificación de sus vacaciones perfectas, puede contactar al guía.',
  fr: 'Pour des informations détaillées sur la planification de vos vacances parfaites, vous pouvez contacter le guide.',
  it: 'Per informazioni dettagliate sulla pianificazione delle tue vacanze perfette, puoi contattare la guida.',
  ko: '완벽한 휴가 계획에 대한 자세한 정보는 가이드에게 문의할 수 있습니다.',
  kk: 'Идеалды демалысты жоспарлау бойынша толық ақпарат алу үшін гидке хабарласуға болады.',
  mn: 'Төгс амралтын төлөвлөх талаар дэлгэрэнгүй мэдээллийг авахын тулд та аялагчид хандаж болно.',
  vi: 'Để biết thông tin chi tiết về lập kế hoạch cho kỳ nghỉ hoàn hảo của bạn, bạn có thể liên hệ với hướng dẫn viên.'
};

for (const item of $input.all()) {
  try {
    // Читаем отформатированный ответ
  let reply = item.json.formatted_reply || 
              item.json.original_reply || 
              item.json.output || 
              item.json.answer || 
              '';
  
  if (!reply || !reply.trim()) {
    items.push({
      json: {
        reply: 'Спасибо! Скоро ответим.'
      }
    });
    continue;
  }
  
    // Ограничиваем длину ответа (~3000 символов, примерно 3000 токенов)
    // Сохраняем HTML теги при обрезке
    const maxLength = 3000;
    if (reply.length > maxLength) {
      // Ищем последний закрывающий тег перед лимитом
      let cutPoint = maxLength;
      const lastTag = reply.lastIndexOf('<', cutPoint);
      if (lastTag > maxLength - 100) { // Если тег близко к лимиту
        const tagEnd = reply.indexOf('>', lastTag);
        if (tagEnd > 0 && tagEnd < maxLength + 50) {
          cutPoint = tagEnd + 1;
        }
      }
      reply = reply.substring(0, cutPoint) + '...';
    }
    
    // Определяем язык пользователя
    // Пробуем найти язык в текущих данных или в предыдущих узлах
    let detectedLang = item.json.detected_language || 
                       item.json.lang || 
                       item.json.language ||
                       '';
    
    // Если язык не найден, пробуем получить из предыдущих узлов через $()
    if (!detectedLang) {
      try {
        // Пробуем получить из узла "Process & Combine Data"
        const processData = $('Process & Combine Data');
        if (processData && processData.item && processData.item.json) {
          detectedLang = processData.item.json.detected_language || 
                        processData.item.json.lang || 
                        '';
        }
      } catch (e) {
        // Игнорируем ошибку, если узел недоступен
      }
      
      // Если все еще нет, пробуем из "Normalize From Site"
      if (!detectedLang) {
        try {
          const normalizeData = $('Normalize From Site');
          if (normalizeData && normalizeData.item && normalizeData.item.json) {
            detectedLang = normalizeData.item.json.lang || 
                          normalizeData.item.json.detected_language || 
                          '';
          }
        } catch (e) {
          // Игнорируем ошибку
        }
      }
    }
    
    // Если язык в формате объекта, извлекаем текст
    if (typeof detectedLang === 'object') {
      if (detectedLang.text) detectedLang = detectedLang.text;
      else if (detectedLang.candidates && detectedLang.candidates[0]) {
        detectedLang = detectedLang.candidates[0].content?.parts?.[0]?.text || 'en';
    }
    }
    
    const langCode = String(detectedLang || 'en').slice(0, 2).toLowerCase();
  
  // Добавляем финальную фразу на языке пользователя
    const finalPhrase = finalPhrases[langCode] || finalPhrases['en'];
  
    // Проверяем, что финальная фраза еще не добавлена
    if (!reply.toLowerCase().includes('гид') && !reply.toLowerCase().includes('guide') && !reply.toLowerCase().includes('guía')) {
      reply += '<br><br><strong>' + finalPhrase + '</strong>';
  }
  
  items.push({
    json: {
        reply: reply.trim()
      }
    });
    
  } catch (error) {
    items.push({
      json: {
        reply: 'Спасибо! Скоро ответим.',
        _error: error.message
    }
  });
  }
}

return items.length > 0 ? items : [{ json: { reply: 'Спасибо! Скоро ответим.' } }];
