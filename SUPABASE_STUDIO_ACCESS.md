# 🔗 Доступ к Supabase Studio

## Настройка SSH туннеля

Используется локальный Supabase! Studio работает на порту **3100** на сервере.

### Правильная команда для SSH туннеля:

```bash
ssh -i ~/.ssh/id_ed25519_autoro -L 3100:127.0.0.1:3100 vladx@46.250.228.229
```

**Важно:** Не нужно указывать `-L 3100:127.0.0.1:3100` дважды. Команда выше правильная.

### После подключения:

Откройте в браузере:
```
http://127.0.0.1:3100
```

## Создание bucket через Studio

1. Подключитесь через SSH туннель (команда выше)
2. Откройте http://127.0.0.1:3100
3. Войдите в Studio (если требуется)
4. Перейдите в **Storage** → **Buckets**
5. Нажмите **New Bucket**
6. Название: `blog-images`
7. Public bucket: **Включить**
8. Сохранить

## Создание bucket через SQL Editor

1. В Supabase Studio откройте **SQL Editor**
2. Выполните SQL:

```sql
-- Create bucket for blog images in Supabase Storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-images', 'blog-images', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for blog-images bucket
CREATE POLICY IF NOT EXISTS "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'blog-images' 
  AND auth.email() = 'autoro.tech@gmail.com'
);

CREATE POLICY IF NOT EXISTS "Allow public read access"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'blog-images');

CREATE POLICY IF NOT EXISTS "Allow admin updates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'blog-images' 
  AND auth.email() = 'autoro.tech@gmail.com'
);

CREATE POLICY IF NOT EXISTS "Allow admin deletes"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'blog-images' 
  AND auth.email() = 'autoro.tech@gmail.com'
);
```

## Настройка Google OAuth

**Важно:** Используется локальный Supabase через `https://api.autoro.tech` (проксируется через Kong).

1. В Supabase Studio → **Authentication** → **Providers**
2. Включите **Google**
3. Добавьте:
   - **Client ID** (из Google Cloud Console)
   - **Client Secret** (из Google Cloud Console)
4. В Google Cloud Console добавьте Redirect URI:
   - `https://api.autoro.tech/auth/v1/callback`

## Текущая конфигурация

- **Supabase URL**: `https://api.autoro.tech` (проксируется на локальный Supabase)
- **Studio**: `127.0.0.1:3100` (через SSH туннель)
- **Kong Gateway**: `0.0.0.0:54321->8000/tcp` (публичный доступ)
- **Database**: Локальный PostgreSQL в Docker

