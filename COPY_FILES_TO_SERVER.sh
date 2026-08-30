#!/bin/bash
# Простой скрипт для копирования файлов

SSH_KEY=~/.ssh/id_ed25519_autoro
SERVER=vladx@46.250.228.229
REMOTE=/home/vladx/autoro-blog
LOCAL=/Users/vlad_x/Desktop/n8n/autoro.tech/website

echo "Копирование route.ts..."
scp -i $SSH_KEY $LOCAL/blog-autoro/app/api/admin/posts/route.ts $SERVER:$REMOTE/app/api/admin/posts/

echo "Копирование api-client.ts..."
scp -i $SSH_KEY $LOCAL/blog-autoro/lib/supabase/api-client.ts $SERVER:$REMOTE/lib/supabase/

echo "Копирование cors.ts..."
scp -i $SSH_KEY $LOCAL/blog-autoro/lib/cors.ts $SERVER:$REMOTE/lib/

echo "Готово! Теперь перезапустите контейнер:"
echo "ssh -i $SSH_KEY $SERVER 'cd $REMOTE && docker-compose restart autoro-blog-nextjs'"

