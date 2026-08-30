document.addEventListener('DOMContentLoaded', function() {
  // 1. Detect Language
  const path = window.location.pathname;
  let lang = 'en';
  if (path.includes('/ru/')) lang = 'ru';
  else if (path.includes('/es/')) lang = 'es';
  else if (path.includes('/it/')) lang = 'it';
  else if (path.includes('/vi/')) lang = 'vi';

  const t = {
    en: {
      welcome: "Hello. Please share your questions, suggestions, or ideas for features that might be useful to you.",
      placeholder: "Type your question...",
      send: "Send",
      title: "Ask Autoro",
      agentBtn: "I want AI Agent",
      close: "Close"
    },
    ru: {
      welcome: "Здравствуйте. Пожалуйста, поделитесь вашими вопросами, предложениями или идеями функций, которые могут быть вам полезны.",
      placeholder: "Введите ваш вопрос...",
      send: "Отправить",
      title: "Спросить Autoro",
      agentBtn: "Хочу AI Агента",
      close: "Закрыть"
    },
    es: {
      welcome: "Hola. Por favor, comparta sus preguntas, sugerencias o ideas de funciones que podrían serle útiles.",
      placeholder: "Escribe tu pregunta...",
      send: "Enviar",
      title: "Preguntar a Autoro",
      agentBtn: "Quiero Agente IA",
      close: "Cerrar"
    },
    it: {
      welcome: "Ciao. Per favore condividi le tue domande, suggerimenti o idee per funzionalità che potrebbero esserti utili.",
      placeholder: "Scrivi la tua domanda...",
      send: "Invia",
      title: "Chiedi a Autoro",
      agentBtn: "Voglio Agente AI",
      close: "Chiudi"
    },
    vi: {
      welcome: "Xin chào. Vui lòng chia sẻ câu hỏi, đề xuất hoặc ý tưởng về các tính năng có thể hữu ích cho bạn.",
      placeholder: "Nhập câu hỏi của bạn...",
      send: "Gửi",
      title: "Hỏi Autoro",
      agentBtn: "Tôi muốn AI Agent",
      close: "Đóng"
    }
  }[lang];

  // 2. Create Widget HTML
  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'chatbot-widget';
  
  // Modal structure similar to screenshot
  widgetContainer.innerHTML = `
    <div class="chatbot-overlay" id="chatbot-overlay"></div>
    <div class="chatbot-modal" id="chatbot-window">
      <div class="chatbot-header">
        <span class="chatbot-title">${t.title}</span>
        <div class="chatbot-header-actions">
            <a href="https://swoop.autoro.tech/login?mode=signup" class="chatbot-agent-btn">${t.agentBtn}</a>
            <button id="chatbot-close" class="chatbot-close-btn">${t.close}</button>
        </div>
      </div>
      <div class="chatbot-body">
        <div class="chatbot-messages" id="chatbot-messages">
            <div class="message bot">${t.welcome}</div>
        </div>
      </div>
      <div class="chatbot-footer">
        <div class="chatbot-input-wrapper">
            <input type="text" id="chatbot-input-field" placeholder="${t.placeholder}">
            <button id="chatbot-send">${t.send}</button>
        </div>
      </div>
    </div>
    
    <!-- Floating Toggle Button (Fixed at bottom right) -->
    <button class="chatbot-toggle" id="chatbot-toggle">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    </button>
  `;
  document.body.appendChild(widgetContainer);

  // 3. Logic
  const toggle = document.getElementById('chatbot-toggle');
  const close = document.getElementById('chatbot-close');
  const overlay = document.getElementById('chatbot-overlay');
  const windowEl = document.getElementById('chatbot-window');
  const input = document.getElementById('chatbot-input-field');
  const send = document.getElementById('chatbot-send');
  const messages = document.getElementById('chatbot-messages');

  const openChat = () => {
    windowEl.classList.add('open');
    overlay.classList.add('open');
    toggle.style.display = 'none';
  };

  const closeChat = () => {
    windowEl.classList.remove('open');
    overlay.classList.remove('open');
    toggle.style.display = 'flex';
  };
  
  toggle.addEventListener('click', openChat);
  close.addEventListener('click', closeChat);
  overlay.addEventListener('click', closeChat);

  const addMessage = (text, sender) => {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  };

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    // Placeholder for N8N
    setTimeout(() => {
        // Simulating typing or waiting
        // In future: fetch(webhook, { body: { text, lang } })
        // For now, just silent or echo if needed, but user asked just for UI
    }, 500);
  };

  send.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
});
