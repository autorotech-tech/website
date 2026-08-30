import json
import os
import sys

# Добавляем путь к каталогу с agent-api, если нужно
sys.path.append(os.path.join(os.path.dirname(__file__), "agent-api"))

import psycopg2
import psycopg2.extras

# Берем те же переменные окружения по умолчанию, что и в main.py
PGHOST = os.environ.get("PGHOST", "supabase-db")
PGPORT = int(os.environ.get("PGPORT") or "5433")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")
PGUSER = os.environ.get("PGUSER", "supabase_admin")
PGPASSWORD = os.environ.get("PGPASSWORD", "supabase_password_e97577f974376e8d")

# Для локальной разработки, если мы за пределами докера, попробуем localhost
hosts_to_try = [PGHOST]
if PGHOST == "supabase-db":
    hosts_to_try.append("127.0.0.1")

print(f"Trying to connect to postgres. Hosts: {hosts_to_try}, Port: {PGPORT}, DB: {PGDATABASE}, User: {PGUSER}")

conn = None
for host in hosts_to_try:
    try:
        conn = psycopg2.connect(
            host=host, port=PGPORT, dbname=PGDATABASE,
            user=PGUSER, password=PGPASSWORD,
            connect_timeout=3
        )
        print(f"Successfully connected to host: {host}")
        break
    except Exception as e:
        print(f"Failed to connect to host {host}: {e}")

if not conn:
    print("Could not connect to database on any host.")
    sys.exit(1)

# Создаем структуру маршрутизации, которая использует ВСЕ подходящие API-ключи:
# Сначала Gemini/GLM/Groq/OpenAI, чтобы НЕ опираться только на OpenRouter!
routing_payload = {
    "tiers": {
        "code": [
            {"provider": "openai", "model": "gpt-4o"},
            {"provider": "gemini", "model": "gemini-2.0-pro-exp-02-05"},
            {"provider": "openrouter", "model": "anthropic/claude-3.5-sonnet"},
            {"provider": "glm", "model": "glm-4-plus"}
        ],
        "reasoning": [
            {"provider": "gemini", "model": "gemini-2.0-flash-thinking-exp"},
            {"provider": "groq", "model": "deepseek-r1-distill-llama-70b"},
            {"provider": "openrouter", "model": "deepseek/deepseek-r1"},
            {"provider": "openai", "model": "o1-mini"}
        ],
        "fast": [
            {"provider": "groq", "model": "llama-3.3-70b-versatile"},
            {"provider": "gemini", "model": "gemini-2.0-flash"},
            {"provider": "glm", "model": "glm-4-flash"},
            {"provider": "openai", "model": "gpt-4o-mini"}
        ],
        "general": [
            {"provider": "gemini", "model": "gemini-2.0-flash"},
            {"provider": "glm", "model": "glm-4-flash"},
            {"provider": "groq", "model": "llama-3.3-70b-versatile"},
            {"provider": "openai", "model": "gpt-4o-mini"},
            {"provider": "openrouter", "model": "anthropic/claude-3.5-sonnet"}
        ]
    },
    "fallback": [
        {"provider": "gemini", "model": "gemini-2.0-flash"},
        {"provider": "api_key_groups", "model": ""},
        {"provider": "env_openai", "model": ""}
    ]
}

try:
    with conn.cursor() as cur:
        # Проверяем, есть ли запись в service_settings
        cur.execute("SELECT id FROM public.service_settings WHERE id = 1")
        row = cur.fetchone()
        if not row:
            print("Row with id=1 not found in service_settings. Creating one.")
            cur.execute("INSERT INTO public.service_settings (id, agent_llm_routing) VALUES (1, %s)", (json.dumps(routing_payload),))
        else:
            print("Updating agent_llm_routing in service_settings (id=1)...")
            cur.execute(
                "UPDATE public.service_settings SET agent_llm_routing = %s WHERE id = 1",
                (json.dumps(routing_payload),)
            )
        conn.commit()
        print("Successfully updated public.service_settings with new agent_llm_routing JSON!")
except Exception as e:
    conn.rollback()
    print(f"Error executing database update: {e}")
finally:
    conn.close()
