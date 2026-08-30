#!/usr/bin/env bash
set -euo pipefail

echo "[Perplexica] Проверка Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo "[Perplexica] Docker не найден. Установите Docker Desktop для macOS и запустите его, затем повторите." >&2
  exit 1
fi

# Проверяем, что docker‑демон доступен
if ! docker info >/dev/null 2>&1; then
  echo "[Perplexica] Docker запущен не был. Откройте Docker Desktop и дождитесь, пока демон поднимется." >&2
  exit 1
fi

CONTAINER_NAME="perplexica"
VOLUME_NAME="perplexica-data"
IMAGE_NAME="itzcrazykns1337/perplexica:latest"

echo "[Perplexica] Останавливаю и удаляю старый контейнер (если есть)..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "[Perplexica] Обновляю образ $IMAGE_NAME ..."
docker pull "$IMAGE_NAME"

echo "[Perplexica] Запускаю контейнер..."
docker run -d \
  -p 3000:3000 \
  -v "$VOLUME_NAME":/home/perplexica/data \
  --name "$CONTAINER_NAME" \
  "$IMAGE_NAME"

IP="localhost"
PORT="3000"

cat <<MSG

[Perplexica] Готово ✅

Откройте браузер и перейдите по адресу:
  http://$IP:$PORT

Дальше настройка делается в веб‑интерфейсе:
  1) Выберите провайдера LLM (Ollama / OpenAI / Claude / Gemini / и т.д.).
  2) Укажите API‑ключ и название модели.
  3) Сохраните настройки и задавайте вопросы в верхней строке.

Чтобы перезапустить Perplexica позже:
  docker start $CONTAINER_NAME

Чтобы остановить:
  docker stop $CONTAINER_NAME

MSG

