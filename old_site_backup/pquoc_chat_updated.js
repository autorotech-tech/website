(function(){
	function $(sel, root){ return (root||document).querySelector(sel); }
	function h(t,a,c){ const e=document.createElement(t); if(a) Object.entries(a).forEach(([k,v])=>{ if(k==='class') e.className=v; else if(k==='text') e.textContent=v; else e.setAttribute(k,v); }); (c||[]).forEach(x=>e.appendChild(x)); return e; }
	function sanitize(text){
		let s = text.replace(/[<>]/g,'');
		s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g,'');
		s = s.replace(/\s+/g,' ').trim();
		return s;
	}

	function mount(){
		const bar = h('div', { class: 'chat-fab', role:'region', 'aria-label':'Chat' }, [
			h('input', { type:'text', placeholder:'Ask us anything…', maxlength:'500' }),
			h('button', { type:'button' }, [ document.createTextNode('Send') ])
		]);
		document.body.appendChild(bar);

		const modal = h('div', { class:'chat-modal', id:'chat-modal' }, [
			h('div', { class:'chat-panel' }, [
				h('div', { class:'chat-header' }, [
					h('span', { text:'Ask Phu Quoc' }),
					h('div', { class:'chat-header-actions' }, [
						h('button', { class:'chat-ai-btn', type:'button', id:'chat-ai-btn' }, [document.createTextNode('AI Agent')]),
						h('button', { class:'chat-close', type:'button' }, [document.createTextNode('Close')])
					])
				]),
				h('div', { class:'chat-scroll', id:'chat-scroll' }),
				h('form', { class:'chat-input', id:'chat-form' }, [
					h('input', { type:'text', name:'msg', placeholder:'Type your question…', autocomplete:'off', maxlength:'500', required:'true' }),
					h('button', { type:'submit' }, [document.createTextNode('Send')])
				])
			])
		]);
		document.body.appendChild(modal);

		const barInput = $('input', bar);
		const barSend = $('button', bar);
		const form = $('#chat-form', modal);
		const input = $('input[name="msg"]', form);
		const scroll = $('#chat-scroll', modal);
		const closeBtn = $('.chat-close', modal);
		const aiBtn = $('#chat-ai-btn', modal);

		function openModal(prefill){
			modal.classList.add('open');
			if(prefill){ input.value = prefill; }
			setTimeout(()=>input.focus(), 60);
		}
		function closeModal(){ modal.classList.remove('open'); }
		function addMsg(text, me, isPending = false){
			const el = h('div', { class: 'chat-msg '+(me?'user':'bot') });
			if (me) {
				// Пользовательские сообщения - только текст (безопасность)
				el.textContent = text;
			} else {
				// Сообщения бота - поддерживаем HTML для ссылок
				if (isPending) {
					// Для статуса поиска добавляем мигающие точки
					const baseText = text.replace(/\.\.\./g, ''); // Убираем точки если есть
					el.innerHTML = baseText + '<span class="chat-typing-dots"><span>.</span><span>.</span><span>.</span></span>';
				} else {
					// Для финального ответа используем HTML
					el.innerHTML = text;
				}
			}
			scroll.appendChild(el); scroll.scrollTop = scroll.scrollHeight;
			return el; // Возвращаем элемент для обновления
		}

		// Определение языка пользователя
		const htmlLang = (document.documentElement.getAttribute('lang')||'').slice(0,2);
		const pathSeg = (location.pathname.split('/').filter(Boolean)[0]||'');
		const pathLang = pathSeg.slice(0,2);
		const navLang  = (navigator.language||'en').slice(0,2);
		const rawLang = (htmlLang || pathLang || navLang || 'en');
		const langMap = { kz: 'kk' };
		const lang = (langMap[rawLang] || rawLang);

		// Приветствия
		const greetings = {
			ru: "Привет.\n\nЯ - твой гид по острову. Я знаю многое.\n\nСмело задавай вопросы, и я помогу тебе провести хорошо время здесь.",
			en: "Hello.\n\nI am your guide to the island. I know a lot.\n\nFeel free to ask questions, and I will help you have a good time here.",
			es: "Hola.\n\nSoy tu guía en la isla. Pregunta libremente y te ayudaré a pasar un buen tiempo aquí.",
			fr: "Bonjour.\n\nJe suis votre guide sur l'île. N'hésitez pas à poser vos questions — je vous aiderai à bien profiter d'ici.",
			it: "Ciao.\n\nSono la tua guida sull'isola. Sentiti libero di chiedere: ti aiuterò a passare un bel tempo qui.",
			ko: "안녕하세요.\n\n저는 섬 가이드입니다. 무엇이든 편하게 질문하세요. 이곳에서 좋은 시간을 보낼 수 있도록 도와드릴게요.",
			kk: "Сәлем.\n\nМен арал бойынша сіздің гидіңізбін. Еркін сұрақ қойыңыз, мұнда жақсы уақыт өткізуге көмектесемін.",
			mn: "Сайн байна уу.\n\nБи танай аралын хөтөч. Ямар ч асуулт байвал асуугаас бүү цааргал — энд сайхан өнгөрүүлэхэд чинь тусалъя.",
			vi: "Xin chào.\n\nTôi là hướng dẫn viên của bạn tại đảo. Cứ thoải mái hỏi, tôi sẽ giúp bạn có thời gian tuyệt vời ở đây."
		};
		setTimeout(()=>{ addMsg(greetings[lang]||greetings.en, false); }, 50);

		// Локализация подписи AI‑кнопки
		const aiBtnTextMap = {
			ru: 'Хочу AI Agent',
			en: 'I want AI Agent',
			es: 'Quiero AI Agent',
			fr: 'Je veux AI Agent',
			it: 'Voglio AI Agent',
			ko: 'AI Agent 원해요',
			kk: 'AI Agent қалаймын',
			mn: 'AI Agent хүсэж байна',
			vi: 'Tôi muốn AI Agent'
		};
		if (aiBtn) aiBtn.textContent = aiBtnTextMap[lang] || aiBtnTextMap.en;

		// Локализация статуса поиска
		const searchingMap = {
			en: "Searching for info…",
			ru: "Ищу информацию…",
			es: "Buscando información…",
			fr: "Je cherche des infos…",
			it: "Cerco informazioni…",
			ko: "정보를 찾고 있어요…",
			kk: "Ақпарат іздеудемін…",
			mn: "Мэдээлэл хайж байна…",
			vi: "Đang tìm thông tin…"
		};

		// Bar interactions
		barInput.addEventListener('focus', ()=> openModal(barInput.value));
		barSend.addEventListener('click', ()=> openModal(barInput.value));

		// Modal interactions
		const sendTimestamps = [];
		let isRequestInProgress = false; // Блокировка повторных отправок
		function canSend(){
			if(isRequestInProgress) return false; // Блокируем если запрос в процессе
			const now = Date.now();
			while(sendTimestamps.length && now - sendTimestamps[0] > 30000) sendTimestamps.shift();
			return sendTimestamps.length < 5;
		}

		form.addEventListener('submit', async (e)=>{
			e.preventDefault();
			const raw = input.value.trim(); if(!raw) return;
			if(!canSend()){ 
				if(isRequestInProgress){
					addMsg('Please wait for the previous request to complete.', false);
				} else {
					addMsg('Please wait a bit before sending more messages.', false);
				}
				return; 
			}
			
			isRequestInProgress = true;
			const safe = sanitize(raw);
			addMsg(safe, true);
			input.value='';
			sendTimestamps.push(Date.now());

			// Показываем статус поиска на языке пользователя с анимацией точек
			const searchingText = searchingMap[lang] || searchingMap.en;
			const pendingBot = addMsg(searchingText, false, true); // isPending = true для анимации

			let requestCompleted = false;
			let timeoutId = null;
			
			console.log('Chat: Starting request...', { message: safe, lang });
			
			try{
				const session = localStorage.getItem('autoro_chat_sid') || (()=>{ const id=crypto.randomUUID(); localStorage.setItem('autoro_chat_sid', id); return id; })();
				const requestBody = { session, lang, message: safe, userAgent: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
				
				console.log('Chat: Request body prepared', { session, url: '/api/chat-webhook' });
				
				// Таймаут 180 секунд для запроса (ждём завершения workflow)
				const controller = new AbortController();
				timeoutId = setTimeout(() => {
					console.log('Chat: Request timeout triggered (180s)');
					controller.abort();
				}, 180000);
				
				console.log('Chat: Sending fetch request...');
				const res = await fetch('/api/chat-webhook', {
					method:'POST', 
					headers:{'Content-Type':'application/json'},
					body: JSON.stringify(requestBody),
					signal: controller.signal
				});
				
				console.log('Chat: Response received', { status: res.status, statusText: res.statusText, ok: res.ok });
				
				if(timeoutId) clearTimeout(timeoutId);
				
				requestCompleted = true;
				
				if(res.ok){
					// Получаем сырой текст ответа для диагностики
					let responseText = '';
					try {
						responseText = await res.text();
						console.log('Chat: Raw response received', {
							length: responseText.length,
							contentType: res.headers.get('content-type'),
							first200: responseText.substring(0, 200),
							last200: responseText.length > 200 ? responseText.substring(responseText.length - 200) : ''
						});
					} catch(textErr) {
						console.error('Chat: Failed to read response text', textErr);
						pendingBot.innerHTML = 'Ошибка при получении ответа. Попробуйте еще раз.';
						isRequestInProgress = false;
						return;
					}
					
					// Проверяем, что ответ не пустой
					if(!responseText || !responseText.trim()){
						console.error('Chat: Empty response received');
						pendingBot.innerHTML = 'Получен пустой ответ. Попробуйте еще раз.';
						isRequestInProgress = false;
						return;
					}
					
					let data = null;
					try {
						data = JSON.parse(responseText);
						console.log('Chat: JSON parsed successfully', {
							hasReply: 'reply' in data,
							hasMessage: 'message' in data,
							keys: Object.keys(data),
							replyLength: data.reply ? String(data.reply).length : 0
						});
					} catch(parseErr) {
						console.error('Chat: JSON parse error', {
							error: parseErr.message,
							responsePreview: responseText.substring(0, 500),
							responseLength: responseText.length
						});
						// Если не JSON, пробуем как текст
						if(responseText.trim()){
							console.warn('Chat: Response is not JSON, treating as plain text');
							pendingBot.innerHTML = responseText;
							isRequestInProgress = false;
							return;
						}
						// Если пустой или не парсится - fallback
						pendingBot.innerHTML = 'Ошибка при обработке ответа. Попробуйте еще раз.';
						isRequestInProgress = false;
						return;
					}
					
					// Проверяем различные варианты структуры ответа
					const reply = data?.reply || data?.message || data?.text || data?.output || data?.answer;
					
					if(reply && typeof reply === 'string' && reply.trim()){
						console.log('Chat: Valid reply found', {
							length: reply.length,
							first100: reply.substring(0, 100)
						});
						// Заменяем статус реальным ответом (с поддержкой HTML)
						pendingBot.innerHTML = reply;
						isRequestInProgress = false;
						return;
					} else {
						console.warn('Chat: No valid reply found in response', { 
							hasData: !!data,
							dataType: typeof data,
							dataKeys: data ? Object.keys(data) : [],
							hasReply: data && 'reply' in data,
							replyType: data?.reply ? typeof data.reply : 'none',
							replyValue: data?.reply ? String(data.reply).substring(0, 100) : 'none',
							fullResponsePreview: responseText.substring(0, 1000)
						});
						// Если данных нет, но структура правильная - возможно пустой reply
						if(data && typeof data === 'object'){
							pendingBot.innerHTML = 'Ответ получен, но содержимое пустое. Попробуйте еще раз.';
						} else {
							pendingBot.innerHTML = 'Неожиданный формат ответа. Попробуйте еще раз.';
						}
						isRequestInProgress = false;
						return;
					}
				} else {
					console.error('Chat: HTTP error', res.status, res.statusText);
					const errorText = await res.text().catch(()=>'');
					console.error('Chat: Error response', errorText);
				}
			}catch(err){ 
				if(timeoutId) clearTimeout(timeoutId);
				console.error('Chat: Exception caught', { 
					name: err.name, 
					message: err.message, 
					stack: err.stack,
					type: typeof err
				});
				
				if(err.name === 'AbortError'){
					console.error('Chat: Request timeout (90s)');
					const timeoutText = (searchingMap[lang] || searchingMap.en || 'Searching').replace(/…|\.\.\./g, '') + ' (Timeout - please try again)';
					if(pendingBot) pendingBot.innerHTML = timeoutText;
					requestCompleted = true;
				} else {
					console.error('Chat: Request error details', err);
					// Показываем ошибку только если это не таймаут
					const errorMsg = err.message || 'Network error';
					console.error('Chat: Will show fallback due to error:', errorMsg);
					requestCompleted = true;
				}
			}
			
			// Не закрываем запрос сообщением-заглушкой — ждём реального ответа
			
			// Разблокируем форму после завершения запроса
			isRequestInProgress = false;
		});
		closeBtn.addEventListener('click', closeModal);
		aiBtn && aiBtn.addEventListener('click', ()=>{
			// Откройте AI Agent сайт в новой вкладке
			const targetUrl = 'https://autoro.tech';
			try { window.open(targetUrl, '_blank', 'noopener,noreferrer'); } catch(e) { console.warn('AI Agent button open failed', e); }
		});
		modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
		input.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && !e.shiftKey && !input.value.trim()) e.preventDefault(); });
	}

	document.addEventListener('DOMContentLoaded', mount);
})();

