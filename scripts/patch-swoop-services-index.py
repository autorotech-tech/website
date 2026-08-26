#!/usr/bin/env python3
"""Patch original autoro.tech index.html: homepage content + Autoro service cards grid."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

_CONTENT_PATCH = Path(__file__).resolve().parent / "patch-autoro-homepage-content.py"
_spec = importlib.util.spec_from_file_location("patch_autoro_homepage_content", _CONTENT_PATCH)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)
patch_homepage_content = _mod.patch_homepage_content

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "old_site_backup" / "html" / "index.html"
OUT = ROOT / "landing" / "index.html"
CATALOG_PATH = ROOT / "landing" / "services-catalog.json"

SWOOP_SECTION_EN = """
                <section id="autoro-services" class="relative z-10 px-4 py-16">
                    <div class="max-w-6xl mx-auto">
                        <div class="text-center mb-12">
                            <h2
                                class="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-[#00F5D4] to-[#667EEA] bg-clip-text text-transparent"
                            >
                                Autoro Platform Services
                            </h2>
                            <p class="text-xl text-gray-300 max-w-3xl mx-auto">
                                AUTORO-API — OpenAI-compatible LLM gateway with auto model selection, key rotation, and provider failover
                            </p>
                        </div>
                        <div id="services-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"></div>
                    </div>
                </section>
"""

SWOOP_SECTION_RU = """
                <section id="autoro-services" class="relative z-10 px-4 py-16">
                    <div class="max-w-6xl mx-auto">
                        <div class="text-center mb-12">
                            <h2
                                class="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-[#00F5D4] to-[#667EEA] bg-clip-text text-transparent"
                            >
                                Сервисы Autoro
                            </h2>
                            <p class="text-xl text-gray-300 max-w-3xl mx-auto">
                                AUTORO-API — OpenAI-compatible LLM gateway: авто-выбор модели, ротация ключей и failover провайдеров
                            </p>
                        </div>
                        <div id="services-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"></div>
                    </div>
                </section>
"""

HEAD_INJECT = '<meta name="catalog-base" content="/services-catalog.json">\n'
SCRIPT_INJECT = '    <script src="/js/render-services.js?v=5" defer></script>\n'

MARKER_AFTER_HERO = re.compile(
    r"(</section>\s*)(<section class=\"relative z-10 px-4 py-16\">\s*<div class=\"max-w-6xl mx-auto\">\s*<div class=\"grid grid-cols-1 md:grid-cols-3 gap-8\">)",
    re.DOTALL,
)


def patch(html: str, *, locale: str = "en") -> str:
    html = patch_homepage_content(html, locale=locale)
    section = SWOOP_SECTION_RU if locale == "ru" else SWOOP_SECTION_EN
    catalog_raw = CATALOG_PATH.read_text(encoding="utf-8").strip()
    json.loads(catalog_raw)  # validate before embed
    inline_catalog = (
        f'<script type="application/json" id="autoro-services-catalog">{catalog_raw}</script>\n'
        '                        '
    )
    section = section.replace(
        '<div id="services-grid"',
        inline_catalog + '<div id="services-grid"',
        1,
    )
    if 'id="autoro-services"' in html or 'id="swoop-services"' in html:
        html = html.replace('id="swoop-services"', 'id="autoro-services"')
        html = html.replace("Swoop Platform Services", "Autoro Platform Services")
        html = html.replace("Сервисы Swoop", "Сервисы Autoro")
        return html

    if 'name="catalog-base"' not in html:
        html = html.replace("</head>", HEAD_INJECT + "</head>", 1)

    if "/js/render-services.js" not in html:
        html = html.replace("<script src=\"/chatbot.js\"></script>", SCRIPT_INJECT + "    <script src=\"/chatbot.js\"></script>", 1)
        if "/js/render-services.js" not in html:
            html = html.replace("</body>", SCRIPT_INJECT + "</body>", 1)
    else:
        html = re.sub(
            r'/js/render-services\.js(\?v=\d+)?',
            '/js/render-services.js?v=5',
            html,
        )

    m = MARKER_AFTER_HERO.search(html)
    if not m:
        raise SystemExit("Could not find hero/stats anchor in index.html")
    html = html[: m.start(2)] + section + html[m.start(2) :]
    return html


def main() -> None:
    locale = "ru" if "--ru" in sys.argv else "en"
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = Path(args[0]) if args else (ROOT / "old_site_backup" / "html" / ("ru/index.html" if locale == "ru" else "index.html"))
    out = Path(args[1]) if len(args) > 1 else (ROOT / ("ru/index.html" if locale == "ru" else "landing/index.html"))
    html = src.read_text(encoding="utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(patch(html, locale=locale), encoding="utf-8")
    print(f"Patched → {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
