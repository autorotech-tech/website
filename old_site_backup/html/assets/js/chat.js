(function(){
	window.AUTORO_CHAT = window.AUTORO_CHAT || {
		bot_id: '',
		botId: '',
		apiUrl: '/api/chat-webhook',
		pollUrl: '/api/chat-poll',
		pollIntervalMs: 3500
	};

	function $(sel, root){ return (root||document).querySelector(sel); }
	function h(t,a,c){ const e=document.createElement(t); if(a) Object.entries(a).forEach(([k,v])=>{ if(k==='class') e.className=v; else if(k==='text') e.textContent=v; else e.setAttribute(k,v); }); (c||[]).forEach(x=>e.appendChild(x)); return e; }
	function sanitize(text){
		let s = String(text ?? '').replace(/[<>]/g,'');
		s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g,'');
		s = s.replace(/\s+/g,' ').trim();
		return s;
	}
	function formatBotText(text){
		const raw = String(text ?? '');
		let out = raw
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n').replace(/<p[^>]*>/gi, '')
			.replace(/<li[^>]*>/gi, '• ').replace(/<\/li>/gi, '\n')
			.replace(/<\/?ul[^>]*>/gi, '')
			.replace(/<\/?b[^>]*>/gi, '')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
		out = out.replace(/<[^>]+>/g, '');
		out = out.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g,'');
		out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
		return out;
	}

	function renderTextWithLinks(rootEl, text){
		while(rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
		const s = String(text ?? '');
		const lines = s.split('\n');
		const trailPunct = ".,;:!?)]}'\"";
		function isWs(ch){ return !ch || ch <= ' '; }
		function stripTrailingPunct(url){
			let u = url;
			while(u.length){
				const last = u[u.length-1];
				if(trailPunct.indexOf(last) === -1) break;
				u = u.slice(0, -1);
			}
			return u;
		}
		function appendLink(url){
			const a = document.createElement('a');
			a.href = url;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = url;
			rootEl.appendChild(a);
		}
		function linkifyLine(line){
			let i = 0;
			while(i < line.length){
				const iHttp  = line.indexOf('http://', i);
				const iHttps = line.indexOf('https://', i);
				let j = -1;
				if(iHttp !== -1 && iHttps !== -1) j = Math.min(iHttp, iHttps);
				else j = (iHttp !== -1 ? iHttp : iHttps);
				if(j === -1){
					rootEl.appendChild(document.createTextNode(line.slice(i)));
					return;
				}
				if(j > i) rootEl.appendChild(document.createTextNode(line.slice(i, j)));
				let end = j;
				while(end < line.length && !isWs(line[end])) end++;
				const rawUrl = line.slice(j, end);
				const cleanUrl = stripTrailingPunct(rawUrl);
				if(cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')){
					appendLink(cleanUrl);
					const tail = rawUrl.slice(cleanUrl.length);
					if(tail) rootEl.appendChild(document.createTextNode(tail));
				}else{
					rootEl.appendChild(document.createTextNode(rawUrl));
				}
				i = end;
			}
		}
		for(let li=0; li<lines.length; li++){
			linkifyLine(lines[li]);
			if(li !== lines.length-1) rootEl.appendChild(document.createElement('br'));
		}
	}

	function getBotId(cfg){
		return (cfg.bot_id || cfg.botId || document.querySelector('meta[name="autoro-bot-id"]')?.getAttribute('content') || '').trim();
	}

	function getSessionId(){
		const k = 'autoro_chat_sid';
		let v = localStorage.getItem(k);
		if(v) return v;
		const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(16).slice(2);
		localStorage.setItem(k, id);
		return id;
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
					h('span', { text:'Autoro Assistant' }),
					h('button', { class:'chat-close', type:'button' }, [document.createTextNode('Close')])
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

		const htmlLang = (document.documentElement.getAttribute('lang')||'').slice(0,2);
		const pathSeg = (location.pathname.split('/').filter(Boolean)[0]||'');
		const pathLang = pathSeg.slice(0,2);
		const navLang  = (navigator.language||'en').slice(0,2);
		const lang = (htmlLang || pathLang || navLang || 'en');

		const greetings = {
			en: "Hello!\n\nI can help you plan process optimization, content, marketing, or reputation work with AI tools or specialists.\n\nDescribe your business, niche, main goal, geo, and audience (B2B/B2C).",
			ru: "Здравствуйте!\n\nПомогу составить план по автоматизации, контенту, маркетингу или репутации.\n\nОпишите бизнес, нишу, цель, гео и аудиторию (B2B/B2C).",
			es: "¡Hola! Cuéntame tu negocio, objetivo, nicho y audiencia.",
			it: "Ciao! Descrivi attività, obiettivo e target.",
			vi: "Xin chào! Hãy mô tả doanh nghiệp và mục tiêu của bạn."
		};
		const searchingMap = {
			en: "Sending…",
			ru: "Отправляю…",
			es: "Enviando…",
			it: "Invio…",
			vi: "Đang gửi…"
		};
		const ackFallback = {
			en: "Thanks! An Autoro specialist will reply here shortly.",
			ru: "Спасибо! Специалист Autoro скоро ответит здесь.",
			es: "¡Gracias! Un especialista responderá pronto.",
			it: "Grazie! Uno specialista risponderà a breve.",
			vi: "Cảm ơn! Chuyên gia sẽ trả lời sớm."
		};

		let pollTimer = null;
		let pollSince = localStorage.getItem('autoro_chat_poll_since') || new Date(0).toISOString();
		const seenReplyIds = new Set(JSON.parse(localStorage.getItem('autoro_chat_seen') || '[]'));

		function openModal(prefill){
			modal.classList.add('open');
			if(prefill){ input.value = prefill; }
			startPolling();
			setTimeout(()=>input.focus(), 60);
		}
		function closeModal(){
			modal.classList.remove('open');
			stopPolling();
		}

		window.openAutoroChat = function(prefill){
			openModal(typeof prefill === 'string' ? prefill : '');
		};

		document.addEventListener('click', function(e){
			const trigger = e.target.closest('[data-autoro-chat-open]');
			if(!trigger) return;
			e.preventDefault();
			window.openAutoroChat('');
		});

		function addMsg(text, me){
			const el = h('div', { class: 'chat-msg '+(me?'user':'bot') });
			if(me){
				el.textContent = text;
			}else{
				renderTextWithLinks(el, formatBotText(text));
			}
			scroll.appendChild(el);
			scroll.scrollTop = scroll.scrollHeight;
			return el;
		}

		setTimeout(()=>{ addMsg(greetings[lang]||greetings.en, false); }, 50);

		function persistSeen(){
			localStorage.setItem('autoro_chat_seen', JSON.stringify(Array.from(seenReplyIds).slice(-100)));
			localStorage.setItem('autoro_chat_poll_since', pollSince);
		}

		async function pollReplies(){
			const cfg = window.AUTORO_CHAT || {};
			const botId = getBotId(cfg);
			const session = getSessionId();
			if(!botId || !modal.classList.contains('open')) return;
			const pollUrl = cfg.pollUrl || '/api/chat-poll';
			try{
				const q = new URLSearchParams({ bot_id: botId, session_id: session, since: pollSince });
				const res = await fetch(`${pollUrl}?${q.toString()}`, { method:'GET', credentials:'same-origin' });
				if(!res.ok) return;
				const data = await res.json().catch(()=>null);
				const messages = data && Array.isArray(data.messages) ? data.messages : [];
				for(const m of messages){
					const id = String(m.id || m.at || m.reply || '');
					if(!id || seenReplyIds.has(id)) continue;
					seenReplyIds.add(id);
					if(m.at && m.at > pollSince) pollSince = m.at;
					addMsg(String(m.reply || ''), false);
				}
				if(messages.length) persistSeen();
			}catch(_e){ /* ignore */ }
		}

		function startPolling(){
			stopPolling();
			pollReplies();
			const cfg = window.AUTORO_CHAT || {};
			const ms = Number(cfg.pollIntervalMs) || 3500;
			pollTimer = setInterval(pollReplies, ms);
		}
		function stopPolling(){
			if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
		}

		barInput.addEventListener('focus', ()=> openModal(barInput.value));
		barSend.addEventListener('click', ()=> openModal(barInput.value));

		const sendTimestamps = [];
		function canSend(){
			const now = Date.now();
			while(sendTimestamps.length && now - sendTimestamps[0] > 30000) sendTimestamps.shift();
			return sendTimestamps.length < 5;
		}

		form.addEventListener('submit', async (e)=>{
			e.preventDefault();
			const raw = input.value.trim(); if(!raw) return;
			if(!canSend()){ addMsg(lang==='ru' ? 'Подождите немного перед следующим сообщением.' : 'Please wait before sending more messages.', false); return; }
			const safe = sanitize(raw);
			addMsg(safe, true);
			input.value='';
			sendTimestamps.push(Date.now());

			const searchingText = searchingMap[lang] || searchingMap.en;
			const pendingBot = addMsg(searchingText, false);

			try{
				const cfg = window.AUTORO_CHAT || {};
				const apiUrl = cfg.apiUrl || '/api/chat-webhook';
				const botId = getBotId(cfg);
				const session = getSessionId();
				if(!botId){
					renderTextWithLinks(pendingBot, lang==='ru' ? 'Чат не настроен (bot_id). Напишите на tech@autoro.tech' : 'Chat is not configured (bot_id). Email tech@autoro.tech');
					return;
				}
				const payload = {
					bot_id: botId,
					botId: botId,
					session,
					session_id: session,
					lang,
					message: safe,
					page_url: location.href,
					referrer: document.referrer || '',
					userAgent: navigator.userAgent,
					tz: Intl.DateTimeFormat().resolvedOptions().timeZone
				};
				const res = await fetch(apiUrl, {
					method:'POST', headers:{'Content-Type':'application/json'},
					body: JSON.stringify(payload)
				});
				if(res.ok){
					const data = await res.json().catch(()=>null);
					if(data && typeof data.reply === 'string' && data.reply.trim()){
						renderTextWithLinks(pendingBot, formatBotText(data.reply));
						pollSince = new Date().toISOString();
						persistSeen();
						return;
					}
				}
			}catch(_err){ /* swallow */ }
			renderTextWithLinks(pendingBot, ackFallback[lang] || ackFallback.en);
		});

		closeBtn.addEventListener('click', closeModal);
		modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
		input.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && !e.shiftKey && !input.value.trim()) e.preventDefault(); });
	}

	document.addEventListener('DOMContentLoaded', mount);
})();
