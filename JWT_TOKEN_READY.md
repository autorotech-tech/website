# JWT токен готов

## ✅ Что сделано

1. **JWT токен сгенерирован и сохранён вне репозитория**
   ```
   <SUPABASE_SERVICE_ROLE_JWT_REDACTED>
   ```

2. **Токен обновлен** в `/home/vladx/autoro-blog/.env`

3. **Контейнер перезапущен**

## Проверка токена

Токен валидный и содержит:
- **Role:** `service_role` ✅
- **Iss:** `supabase` ✅
- **Aud:** `authenticated` ✅
- **Exp:** Действителен до 2027 года ✅

## Удаление директории mcp-god-mode

Директория требует прав доступа для удаления. Выполните вручную:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
sudo rm -rf /home/vladx/mcp-god-mode
```

Или измените права и удалите:
```bash
chmod -R u+w /home/vladx/mcp-god-mode
rm -rf /home/vladx/mcp-god-mode
```

## Следующие шаги

1. ✅ JWT токен готов - можно тестировать загрузку файлов
2. ⏳ Удалить директорию mcp-god-mode (освободит еще 2.4GB)
3. Проверить работу загрузки файлов в админ-панели


