#!/usr/bin/env python3
"""Transform original autoro.tech homepage HTML: tools, core services, section removals."""
from __future__ import annotations

import os
import re
from typing import Iterable, NamedTuple


class StackSticker(NamedTuple):
    name: str
    mark: str
    bg: str
    fg: str = "#ffffff"


# 8 existing + 4 from Swoop stack (Groq, OpenModel, SearXNG, LMArena Bridge)
STACK_STICKERS: list[StackSticker] = [
    StackSticker("n8n", "n8", "#FF6D5A"),
    StackSticker("OpenRouter", "OR", "#7C3AED"),
    StackSticker("Gemini / GLM", "G·Z", "#4285F4"),
    StackSticker("Scrapling", "Sc", "#059669"),
    StackSticker("GoLogin", "GL", "#2563EB"),
    StackSticker("LangGraph", "LG", "#7C3AED"),
    StackSticker("Supabase", "SB", "#3ECF8E", "#0F172A"),
    StackSticker("FastAPI", "FA", "#009688"),
    StackSticker("Groq", "GQ", "#F97316"),
    StackSticker("OpenModel", "OM", "#0891B2"),
    StackSticker("SearXNG", "SX", "#475569"),
    StackSticker("LMArena", "LA", "#DB2777"),
]

STACK_SECTION_TITLE: dict[str, str] = {
    "en": "Platform & stack",
    "ru": "Платформа и стек",
}

STACK_STICKERS_CSS = """
<style id="autoro-stack-stickers">
#tools .stack-sticker-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.875rem;
  width: 100%;
}
@media (max-width: 1279px) {
  #tools .stack-sticker-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  #tools .stack-sticker-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.625rem; }
}
#tools .stack-sticker {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0.75rem 0.5rem;
  border-radius: 1rem;
  background: linear-gradient(145deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.03) 100%);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 4px 18px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
#tools .stack-sticker:hover {
  transform: translateY(-3px) rotate(-1deg);
  border-color: rgba(0,245,212,0.35);
  box-shadow: 0 10px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12);
}
#tools .stack-sticker-logo {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.72rem;
  letter-spacing: -0.02em;
  box-shadow: 0 6px 14px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.18);
}
#tools .stack-sticker-name {
  font-size: 0.68rem;
  line-height: 1.25;
  font-weight: 600;
  color: rgba(255,255,255,0.92);
  text-align: center;
  max-width: 100%;
  padding: 0 0.15rem;
  word-break: break-word;
}
@media (min-width: 768px) {
  #tools .stack-sticker-name { font-size: 0.75rem; }
  #tools .stack-sticker-logo { width: 3rem; height: 3rem; font-size: 0.78rem; }
}
</style>
"""

TOOLS_CONTENT_RE = re.compile(
    r'(<section id="tools" class="relative z-10 px-4 py-20">\s*'
    r'<div class="max-w-6xl mx-auto">\s*'
    r'<div class="text-center mb-16">.*?</div>\s*)'
    r".*?"
    r"(</div>\s*</section>)",
    re.DOTALL,
)

# --- Core Services (4 items: title + description) ----------------------------

CORE_SERVICES: dict[str, list[tuple[str, str]]] = {
    "en": [
        (
            "Marketing Audit with RAG",
            "Upload Google, Meta, TikTok, and Yandex ad exports. AI indexes campaigns and delivers actionable insights with vector search.",
        ),
        (
            "Embeddable AI Chat Agents",
            "Customer-facing bots on your domain — n8n webhooks, knowledge base roles, and multi-language embed widgets.",
        ),
        (
            "Deep Research with Citations",
            "Perplexity-level search across ArXiv, news, Wikipedia, and the open web via Deep Search and DeerFlow multi-agent stack.",
        ),
        (
            "Stealth Scraping & Platform Ops",
            "Scrapling + GoLogin data collection, expired domain intelligence, and agent-api orchestration on managed infrastructure.",
        ),
    ],
    "ru": [
        (
            "Marketing Audit с RAG",
            "Загрузка выгрузок Google, Meta, TikTok и Яндекс. AI индексирует кампании и даёт actionable-инсайты с векторным поиском.",
        ),
        (
            "Встраиваемые AI Chat Agents",
            "Клиентские боты на вашем домене — n8n webhooks, роли knowledge base и мультиязычный embed-виджет.",
        ),
        (
            "Deep Research с цитатами",
            "Поиск уровня Perplexity по ArXiv, новостям, Wikipedia и web через Deep Search и multi-agent DeerFlow.",
        ),
        (
            "Stealth Scraping и platform ops",
            "Scrapling + GoLogin для сбора данных, expired domains intelligence и оркестрация agent-api на managed-инфраструктуре.",
        ),
    ],
}

OLD_CORE_TITLES = [
    "Smarter Customer Support with AI Chatbots",
    "Ads That Convert — Powered by AI",
    "Advanced Analytics Platform",
    "Hosting and Technical Support",
]

CORE_SECTION_MARKER: dict[str, str] = {
    "en": "Core Services",
    "ru": "Основные услуги",
}

# --- Sections to drop ---------------------------------------------------------

REMOVE_NEEDLES: dict[str, list[str]] = {
    "en": [
        "Automated Product Research Workflow",
        "Frequently Asked Questions",
        "What Our Clients Say",
        "Our Partnership Model",
    ],
    "ru": [
        "Часто задаваемые вопросы",
        "Что мы говорим",
        "Модель партнерских инвестиций",
        "🎯 Кто наши клиенты?",
    ],
}

SERVICES_SECTION_RE = re.compile(
    r'<section id="services" class="relative z-10 px-4 py-20">.*?</section>\s*',
    re.DOTALL,
)


def remove_section_containing(html: str, needle: str) -> str:
    idx = html.find(needle)
    if idx < 0:
        return html
    start = html.rfind("<section", 0, idx)
    if start < 0:
        return html
    end = html.find("</section>", idx)
    if end < 0:
        return html
    end += len("</section>")
    while end < len(html) and html[end] in " \t\n\r":
        end += 1
    return html[:start] + html[end:]


def remove_sections(html: str, needles: Iterable[str]) -> str:
    for needle in needles:
        html = remove_section_containing(html, needle)
    return html


def stack_sticker_html(sticker: StackSticker) -> str:
    return f"""                                <div class="stack-sticker" title="{sticker.name}">
                                    <div class="stack-sticker-logo" style="background:{sticker.bg};color:{sticker.fg}">{sticker.mark}</div>
                                    <span class="stack-sticker-name">{sticker.name}</span>
                                </div>
"""


def build_tools_section_html(locale: str) -> str:
    title = STACK_SECTION_TITLE.get(locale, STACK_SECTION_TITLE["en"])
    cards = "\n".join(stack_sticker_html(s) for s in STACK_STICKERS)
    return f"""                        <div>
                            <p class="text-center text-xs sm:text-sm font-semibold uppercase tracking-[0.2em] text-[#00F5D4]/70 mb-8">{title}</p>
                            <div class="stack-sticker-grid">
{cards}
                            </div>
                        </div>"""


def replace_tools_grid(html: str, locale: str) -> str:
    inner = build_tools_section_html(locale)
    new_html, n = TOOLS_CONTENT_RE.subn(rf"\1{inner}\n                    \2", html, count=1)
    if n:
        return new_html
    return html


def replace_core_services(html: str, locale: str) -> str:
    items = CORE_SERVICES.get(locale, CORE_SERVICES["en"])
    marker = CORE_SECTION_MARKER.get(locale, CORE_SECTION_MARKER["en"])
    idx = html.find(marker)
    if idx < 0:
        return html
    start_section = html.rfind("<section", 0, idx)
    if start_section < 0:
        return html
    end_section = html.find("</section>", idx)
    if end_section < 0:
        return html
    end_section += len("</section>")
    chunk = html[start_section:end_section]

    pattern = re.compile(
        r'(<h3 class="text-xl font-semibold mb-2">)\s*.*?\s*(</h3>\s*<p class="text-gray-300">)\s*.*?\s*(</p>)',
        re.DOTALL,
    )
    i = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal i
        if i >= len(items):
            return m.group(0)
        title, desc = items[i]
        i += 1
        return (
            f'{m.group(1)}\n                                            {title}\n'
            f"                                        {m.group(2)}\n"
            f"                                            {desc}\n"
            f"                                        {m.group(3)}"
        )

    new_chunk = pattern.sub(repl, chunk, count=len(items))
    return html[:start_section] + new_chunk + html[end_section:]


def validate_homepage_html(html: str) -> None:
    if re.search(r'class="grid[^"]*"\s*\n\s*<div', html):
        raise ValueError("Broken tools grid: missing > on grid container")
    if html.count("<section") != html.count("</section>"):
        raise ValueError("Unbalanced <section> tags in homepage HTML")


def inject_stack_sticker_styles(html: str) -> str:
    if 'id="autoro-stack-stickers"' in html:
        return html
    return html.replace("</head>", STACK_STICKERS_CSS + "\n    </head>", 1)


CHAT_CTA_LABELS = ("Request My Free Audit", "Начать сегодня")
GOOGLE_SIGNUP_URL = (
    "https://swoop.autoro.tech/login?mode=signup&next=/chat-agent&google=1"
)


def inject_chat_assets(html: str) -> str:
    bot_id = os.environ.get("AUTORO_SITE_BOT_ID", "").strip()
    if bot_id and 'name="autoro-bot-id"' not in html:
        html = html.replace(
            "</head>",
            f'    <meta name="autoro-bot-id" content="{bot_id}">\n    </head>',
            1,
        )
    if 'assets/js/chat-config.js' not in html:
        html = html.replace(
            'src="assets/js/chat.js',
            'src="assets/js/chat-config.js?v=1"></script>\n    <script src="assets/js/chat.js',
            1,
        )
    html = re.sub(r'src="assets/js/chat\.js\?v=\d+"', 'src="assets/js/chat.js?v=3"', html)
    html = html.replace('src="assets/js/chat.js"', 'src="assets/js/chat.js?v=3"', 1)
    return html


def patch_chat_cta_buttons(html: str) -> str:
    for label in CHAT_CTA_LABELS:
        html = re.sub(
            r'<button(\s+class="inline-flex items-center justify-center gap-2 whitespace-nowrap[^"]*")'
            r'(?:\s+type="button")?(?:\s+data-autoro-chat-open="true")?'
            r'(\s*>\s*)'
            + re.escape(label),
            rf'<a href="{GOOGLE_SIGNUP_URL}"\1\2' + label,
            html,
        )
        html = re.sub(
            rf'({re.escape(label)}<svg[\s\S]*?</svg>\s*)</button>',
            r"\1</a>",
            html,
            count=2,
        )
    return inject_chat_assets(html)


def patch_google_signup_nav(html: str, *, locale: str = "en") -> str:
    signup_label = "Войти" if locale == "ru" else "Sign in"
    if f">{signup_label}<" in html:
        return html
    insert = (
        f'                            <a href="{GOOGLE_SIGNUP_URL}" '
        f'class="hover:text-[#00F5D4] transition-colors">{signup_label}</a>\n'
        "                            </nav>"
    )
    html, n = re.subn(r"[ \t]*</nav>", insert, html, count=1)
    if n != 1:
        raise ValueError("Could not inject Google signup nav link")
    return html


def patch_header_nav(html: str, *, locale: str = "en") -> str:
    html = html.replace('href="#blog"', 'href="/blog"')
    if 'href="/resume/"' in html:
        return html
    resume_label = "Резюме" if locale == "ru" else "Resume"
    blog_label = "Блог" if locale == "ru" else "Blog"
    pattern = re.compile(rf"(>\s*{re.escape(blog_label)}\s*</a\s*>\s*)")
    replacement = (
        rf"\1                                ><a\n"
        rf'                                    href="/resume/"\n'
        rf'                                    class="hover:text-[#00F5D4] transition-colors"\n'
        rf"                                    >{resume_label}</a\n"
    )
    return pattern.sub(replacement, html, count=1)


def patch_homepage_content(html: str, *, locale: str = "en") -> str:
    html = SERVICES_SECTION_RE.sub("", html, count=1)
    html = remove_sections(html, REMOVE_NEEDLES.get(locale, REMOVE_NEEDLES["en"]))
    html = inject_stack_sticker_styles(html)
    html = replace_tools_grid(html, locale)
    html = replace_core_services(html, locale)
    html = patch_chat_cta_buttons(html)
    html = patch_header_nav(html, locale=locale)
    html = patch_google_signup_nav(html, locale=locale)
    validate_homepage_html(html)
    return html
