// Обновлённая функция addMsg для поддержки HTML в ответах бота

// ... остальной код ...

function addMsg(text, me){
  const el = h('div', { class: 'chat-msg '+(me?'user':'bot') });
  
  if (me) {
    // Пользовательские сообщения - только текст (безопасность)
    el.textContent = text;
  } else {
    // Сообщения бота - поддерживаем HTML для ссылок
    // Используем innerHTML, так как мы контролируем форматирование на сервере
    el.innerHTML = text;
    
    // Добавляем стили для ссылок в чате
    const style = document.createElement('style');
    style.textContent = `
      .chat-msg.bot a {
        color: var(--chat-accent, #00f5d4);
        text-decoration: underline;
        word-break: break-all;
      }
      .chat-msg.bot a:hover {
        opacity: 0.8;
      }
      .chat-msg.bot strong {
        font-weight: 600;
      }
      .chat-msg.bot code {
        background: rgba(255,255,255,0.1);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
      }
    `;
    if (!document.getElementById('chat-link-styles')) {
      style.id = 'chat-link-styles';
      document.head.appendChild(style);
    }
  }
  
  scroll.appendChild(el); 
  scroll.scrollTop = scroll.scrollHeight;
  return el;
}

// ... остальной код ...

