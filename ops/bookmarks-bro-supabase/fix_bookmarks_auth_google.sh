#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="/home/vladx/supabase-bookmarks-prod/docker/docker-compose.bookmarks.yml"
ENV_FILE="/home/vladx/supabase-bookmarks-prod/docker/.env.bookmarks"

python3 - <<'PY'
from pathlib import Path

compose = Path("/home/vladx/supabase-bookmarks-prod/docker/docker-compose.bookmarks.yml")
env = Path("/home/vladx/supabase-bookmarks-prod/docker/.env.bookmarks")

text = compose.read_text()
needle = "      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: ${ENABLE_ANONYMOUS_USERS}\n"
insert = (
    "      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOTRUE_EXTERNAL_GOOGLE_ENABLED}\n"
    "      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID}\n"
    "      GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOTRUE_EXTERNAL_GOOGLE_SECRET}\n"
    "      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI}\n"
)

if "GOTRUE_EXTERNAL_GOOGLE_ENABLED:" not in text:
    text = text.replace(needle, needle + insert)
    compose.write_text(text)

env_text = env.read_text()
env_text = env_text.replace(
    "GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.autoro.tech/auth/v1/callback",
    "GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://swoop.autoro.tech/bb-supabase/auth/v1/callback",
)
env.write_text(env_text)
print("updated")
PY

cd /home/vladx/supabase-bookmarks-prod/docker
docker-compose --env-file .env.bookmarks -p supabase-bookmarks -f docker-compose.bookmarks.yml up -d auth kong

docker inspect supabase-auth-bookmarks --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'GOTRUE_EXTERNAL_GOOGLE|GOTRUE_EXTERNAL_EMAIL_ENABLED|GOTRUE_DISABLE_SIGNUP|API_EXTERNAL_URL' | cat
