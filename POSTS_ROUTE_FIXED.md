# Исправление posts/route.ts

## Проблема

Файл `posts/route.ts` имел ошибку компиляции "Unterminated regular expression literal" на строке 31, которая блокировала сборку контейнера.

## Решение

Файл перезаписан полностью из локальной версии. Контейнер должен успешно собираться.

## Следующие шаги

1. Попробуйте загрузить файл снова
2. Проверьте логи с расширенным логированием:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
   docker logs -f autoro-blog-nextjs | grep -E "isAdmin|Upload POST|Cookie|sb-access-token|Validation"
   ```

Логи теперь должны показывать детальную информацию о процессе авторизации.


