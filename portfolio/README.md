# Autoro Swoop - Portfolio (MVP / Prototypes)

PDF and HTML portfolio of Swoop platform modules.

## Files

| File | Description |
|------|-------------|
| `Autoro-Swoop-Portfolio-RU.pdf` | Russian PDF |
| `Autoro-Swoop-Portfolio-EN.pdf` | English PDF (screenshots with EN captions) |
| `portfolio-ru.html` / `portfolio-en.html` | Source HTML |
| `screenshots/` | Screenshots with RU caption bar |
| `screenshots-en/` | Screenshots with EN caption bar |
| `projects.json` | Project metadata (edit here) |

## Regenerate

```bash
cd portfolio
.venv/bin/python add_captions.py   # refresh screenshot captions
cd ..
node portfolio/build-pdf.mjs       # rebuild HTML + PDF (uses system Chrome)
```

## Modules included

1. Deep Search
2. Chat Agent (RAG)
3. AI Blog Engine
4. Expired Domains Hunter
5. Marketing Audit
6. LLM Routing & API Keys
7. Web Scraping & Automation
8. Keept - Realtime Voice AI
9. FinDefender
10. pquoc.com
11. Personal Telegram Assistant (text section)

## Author

Vladislav Kholodin · Forward Deployed Engineer · [autoro.tech](https://autoro.tech) · [resume](https://autoro.tech/resume/)
