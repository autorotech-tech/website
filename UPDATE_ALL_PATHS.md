# Обновление всех путей в инструкциях

## Файлы, требующие обновления путей

Следующие файлы содержат старый путь `/home/vladx/projects/autoro.tech/website/blog-autoro` и должны быть обновлены на `/home/vladx/projects/autoro.tech/website/blog-autoro`:

1. ✅ `START_BLOG_DEV.md` - ОБНОВЛЕН
2. `FINAL_INSTRUCTIONS.md`
3. `ALL_FIXES_AND_INSTRUCTIONS.md`
4. `FIXES_AND_DEVELOPMENT_START.md`
5. `DEVELOPMENT_START_GUIDE.md`
6. `BLOG_DEVELOPMENT_PHASE1.md`
7. `BLOG_DEVELOPMENT_GUIDE.md`
8. `DEVELOPMENT_WORKFLOW.md`
9. `SETUP_COMPLETE.md`
10. `SHADCN_UI_GUIDE.md`
11. `QUICK_START_BLOG_DEV.md`

## Команда для массового обновления

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website
find . -name "*.md" -type f -exec sed -i '' 's|/home/vladx/autoro\.tech/website/blog-autoro|/home/vladx/projects/autoro.tech/website/blog-autoro|g' {} \;
```

## Проверка после обновления

```bash
grep -r "/home/vladx/autoro\.tech/website/blog-autoro" . --include="*.md"
```

Если команда не выводит ничего - все пути обновлены.

---

**Дата:** 2026-01-06

