import os
import time
import json
import base64
import hmac
import hashlib
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import requests
import pandas as pd
import psycopg2
import psycopg2.extras
import jwt


SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
# Ollama removed - using Gemini only

POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "5"))
MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(20 * 1024 * 1024)))  # 20MB

# Direct Postgres access (bypassing Supabase REST RLS) for internal tables
PGHOST = os.environ.get("PGHOST", "supabase-db")
PGPORT = int(os.environ.get("PGPORT", "5433"))  # Supabase Postgres runs on 5433 inside the network
PGDATABASE = os.environ.get("PGDATABASE", "postgres")
PGUSER = os.environ.get("PGUSER", "supabase_admin")
PGPASSWORD = os.environ.get("PGPASSWORD", "supabase_password_e97577f974376e8d")


if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")


def pg_connect():
    return psycopg2.connect(
        host=PGHOST,
        port=PGPORT,
        dbname=PGDATABASE,
        user=PGUSER,
        password=PGPASSWORD,
    )


def log(*args: Any) -> None:
    print("[marketing-audit-processor]", *args, flush=True)


# Cache для JWT_SECRET и JWT токена
_jwt_secret: Optional[str] = None
_service_role_jwt: Optional[str] = None
_jwt_expires_at: float = 0


def get_jwt_secret() -> str:
    """Получаем JWT_SECRET из Postgres (кэшируем)."""
    global _jwt_secret
    if _jwt_secret:
        return _jwt_secret
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('app.settings.jwt_secret', true)")
            row = cur.fetchone()
            if row and row[0]:
                _jwt_secret = row[0]
                return _jwt_secret
    finally:
        conn.close()
    raise RuntimeError("Failed to get JWT_SECRET from Postgres")


def get_service_role_jwt() -> str:
    """Генерируем JWT токен для service_role (кэшируем на 1 час)."""
    global _service_role_jwt, _jwt_expires_at
    now = time.time()
    if _service_role_jwt and now < _jwt_expires_at:
        return _service_role_jwt
    
    secret = get_jwt_secret()
    payload = {
        "iss": "supabase",
        "aud": "authenticated",
        "role": "service_role",
        "iat": int(now),
        "exp": int(now) + 3600,  # 1 час
    }
    _service_role_jwt = jwt.encode(payload, secret, algorithm="HS256")
    _jwt_expires_at = now + 3600
    return _service_role_jwt


def supabase_rest(path: str, method: str = "GET", params: Optional[Dict[str, Any]] = None, body: Optional[Dict[str, Any]] = None):
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path}"
    headers = {
        # Для self-hosted Supabase через Kong достаточно service key в apikey;
        # Authorization заголовок не используем, чтобы не требовать JWT.
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    resp = requests.request(method, url, headers=headers, params=params, data=json.dumps(body) if body is not None else None, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"Supabase {method} {path} failed {resp.status_code}: {resp.text}")
    if resp.text:
        return resp.json()
    return None


def supabase_storage_download(bucket: str, object_path: str) -> bytes:
    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{object_path}"
    jwt_token = get_service_role_jwt()
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {jwt_token}",
    }
    r = requests.get(url, headers=headers, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Storage download failed {r.status_code}: {r.text}")
    data = r.content
    if len(data) > MAX_FILE_BYTES:
        raise RuntimeError("File too large for processing")
    return data


def supabase_storage_upload(bucket: str, object_path: str, data: bytes, content_type: str = "text/csv") -> None:
    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{object_path}"
    jwt_token = get_service_role_jwt()
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {jwt_token}",
        "Content-Type": content_type,
    }
    params = {"upsert": "true"}
    r = requests.post(url, headers=headers, params=params, data=data, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Storage upload failed {r.status_code}: {r.text}")


# Ollama embedding function removed - using external embeddings only

MARKETING_AUDIT_SYSTEM_PROMPT = """You are a senior performance marketing analyst. Your task is to analyze advertising and analytics data.

ANALYSIS STRUCTURE:
1. SUMMARY - Key findings and overall performance assessment
2. TRAFFIC & CONVERSIONS - Analysis of impressions, clicks, CTR, conversions, CR
3. BUDGET STRUCTURE - Spend distribution, CPA, ROI indicators
4. PROBLEMS & RISKS - Identified issues and potential risks
5. CONCRETE ACTIONS - Specific optimization recommendations
6. HYPOTHESES - Ideas for testing and improvement

RULES:
- Answer in Russian
- Use only the provided data
- Be specific with numbers and metrics
- Prioritize actionable insights
- If data is missing, note what additional data would help"""


# Ollama generate function removed - using Gemini only

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")


def gemini_generate(prompt: str, system_prompt: str = MARKETING_AUDIT_SYSTEM_PROMPT, max_tokens: int = 4000) -> Tuple[str, int, int]:
    """Generate text using Google Gemini API. Returns (text, input_tokens, output_tokens)."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not configured")
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{system_prompt}\n\n---\n\n{prompt}"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": max_tokens,
        }
    }
    
    log(f"[gemini] generating with model={GEMINI_MODEL}, prompt_len={len(prompt)}")
    r = requests.post(url, json=payload, timeout=120)
    try:
        data = r.json()
    except Exception:
        data = None
    
    if not r.ok:
        error_msg = data.get("error", {}).get("message", str(data)) if data else r.text
        raise RuntimeError(f"Gemini API error {r.status_code}: {error_msg}")
    
    # Extract response text
    try:
        response = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"Gemini unexpected response format: {data}")
    
    # Extract token usage
    usage = data.get("usageMetadata", {})
    input_tokens = usage.get("promptTokenCount", 0)
    output_tokens = usage.get("candidatesTokenCount", 0)
    
    if not response:
        raise RuntimeError("Gemini returned empty response")
    
    log(f"[gemini] generated {len(response)} chars, tokens: in={input_tokens}, out={output_tokens}")
    return response, input_tokens, output_tokens


def simple_clean_text(text: str) -> str:
    return " ".join((text or "").split())


def load_tabular_dataframe(file_bytes: bytes, filename: str, file_type: str) -> Optional[pd.DataFrame]:
    """Load CSV/XLSX into pandas без потери информации, с мягкой очисткой."""
    ext = (os.path.splitext(filename or "")[1] or "").lower()
    try:
        if file_type in ("text/csv", "csv") or ext == ".csv":
            # on_bad_lines='warn' — пропускаем строки с неправильным количеством колонок
            # Пробуем несколько разделителей: запятая, точка с запятой, табуляция
            for sep in [",", ";", "\t"]:
                try:
                    df = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False, sep=sep, on_bad_lines="warn")
                    if df is not None and not df.empty and len(df.columns) > 1:
                        break
                except Exception:
                    continue
            else:
                # Последняя попытка: Python engine с автоопределением разделителя
                df = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False, sep=None, engine="python", on_bad_lines="warn")
        elif file_type in ("application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") or ext in (".xlsx", ".xls"):
            df = pd.read_excel(BytesIO(file_bytes), dtype=str)
        else:
            return None
    except Exception as e:
        log(f"[tabular] failed to read {filename}: {e}")
        return None

    if df is None or df.empty:
        return None

    # Нормализация: тримим названия колонок, убираем полностью пустые строки и столбцы, убираем дубли.
    df.columns = [str(c).strip() for c in df.columns]
    df.replace({"": None}, inplace=True)
    df.dropna(how="all", inplace=True)
    df = df.loc[:, df.notna().any(axis=0)]
    df.drop_duplicates(inplace=True)
    return df


def clean_documents(task: Dict[str, Any], docs: List[Dict[str, Any]]) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    """Чтение и очистка документов задачи.

    Возвращает:
      - путь к объединённому очищенному CSV (или None, если нечего сохранять);
      - список текстовых чанков для векторизации (по строкам и нетабличным файлам).
    """
    task_id = task["id"]
    user_id = task["user_id"]
    data_source = task.get("data_source") or "unknown"

    tabular_frames: List[pd.DataFrame] = []
    chunks: List[Dict[str, Any]] = []

    for doc in docs:
        file_type = (doc.get("file_type") or "").lower()
        path = doc.get("file_path") or ""
        filename = doc.get("filename") or ""

        # Пропускаем файлы инструкций (*_instructions.csv) — они используются как системный промпт для LLM
        if "_instructions" in filename.lower():
            log(f"[task {task_id}] skipping instructions file: {filename}")
            continue

        # Табличные форматы: CSV/XLSX
        if file_type in ("text/csv", "csv") or path.lower().endswith(".csv") or path.lower().endswith(".xlsx") or path.lower().endswith(".xls") or file_type in ("application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
            try:
                raw = supabase_storage_download("user_uploads", path)
            except Exception as e:
                log(f"[task {task_id}] error downloading {filename}: {e}")
                continue
            df = load_tabular_dataframe(raw, filename, file_type)
            if df is None:
                continue

            df["__source_file"] = filename
            df["__data_source"] = data_source
            tabular_frames.append(df)

            # Для векторизации: один чанк на строку
            for _, row in df.iterrows():
                parts: List[str] = []
                for col, val in row.items():
                    if val is None or str(val).strip() == "":
                        continue
                    parts.append(f"{col}: {val}")
                text = simple_clean_text(" | ".join(parts))
                if not text:
                    continue
                chunks.append(
                    {
                        "chunk_text": text,
                        "metadata": {
                            "task_id": str(task_id),
                            "filename": filename,
                            "file_type": file_type or "csv/xlsx",
                            "data_source": data_source,
                        },
                    }
                )
        else:
            # Нетабличные источники (PDF/DOC/прочий текст/URL) — читаем полностью без очистки
            if file_type == "url":
                text = f"URL source for marketing audit ({data_source}): {filename or path}"
            else:
                try:
                    raw = supabase_storage_download("user_uploads", path)
                    ext = (os.path.splitext(filename or "")[1] or "").lower()
                    
                    if ext == ".pdf" or file_type == "application/pdf":
                        # Извлекаем текст из PDF через PyPDF2
                        try:
                            import PyPDF2
                            reader = PyPDF2.PdfReader(BytesIO(raw))
                            pdf_text_parts = []
                            for page in reader.pages[:50]:  # Ограничим 50 страницами
                                page_text = page.extract_text() or ""
                                if page_text.strip():
                                    pdf_text_parts.append(page_text)
                            text = "\n\n".join(pdf_text_parts)
                            log(f"[task {task_id}] extracted PDF text from {filename}, pages={len(reader.pages)}, chars={len(text)}")
                        except Exception as pdf_err:
                            log(f"[task {task_id}] PDF extraction failed for {filename}: {pdf_err}")
                            text = raw.decode("utf-8", errors="ignore")
                    else:
                        # Другие файлы читаем как текст
                        text = raw.decode("utf-8", errors="ignore")
                    
                    log(f"[task {task_id}] read non-tabular file {filename}, size={len(text)} chars")
                except Exception as e:
                    log(f"[task {task_id}] error reading file {filename}: {e}")
                    continue

            clean = simple_clean_text(text)
            if not clean:
                log(f"[task {task_id}] file {filename} produced empty text after cleaning, skipping")
                continue
            chunks.append(
                {
                    "chunk_text": clean,
                    "metadata": {
                        "task_id": str(task_id),
                        "filename": filename,
                        "file_type": file_type,
                        "data_source": data_source,
                    },
                }
            )

    cleaned_path: Optional[str] = None
    if tabular_frames:
        full_df = pd.concat(tabular_frames, ignore_index=True)
        csv_bytes = full_df.to_csv(index=False).encode("utf-8")
        cleaned_path = f"{user_id}/{task_id}/cleaned/cleaned_{int(time.time())}.csv"
        supabase_storage_upload("user_uploads", cleaned_path, csv_bytes, content_type="text/csv")
        log(f"[task {task_id}] cleaned dataset saved to {cleaned_path}, rows={len(full_df)} cols={len(full_df.columns)}")

    return cleaned_path, chunks


def claim_next_job() -> Optional[Dict[str, Any]]:
    """
    Забираем самую старую job со статусом queued, используя прямой доступ к Postgres.
    Используем SELECT ... FOR UPDATE SKIP LOCKED, чтобы избежать гонок, если воркеров будет несколько.
    """
    conn = pg_connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, task_id, user_id, stage, status
                FROM public.marketing_audit_jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return None
            cur.execute(
                """
                UPDATE public.marketing_audit_jobs
                SET status = 'running', started_at = NOW()
                WHERE id = %s
                """,
                (row["id"],),
            )
        conn.commit()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def finish_job(job_id: str, status: str, error: Optional[str] = None) -> None:
    conn = pg_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.marketing_audit_jobs
                SET status = %s,
                    error = %s,
                    finished_at = NOW()
                WHERE id = %s
                """,
                (status, error, job_id),
            )
    finally:
        conn.close()


def process_job(job: Dict[str, Any]) -> None:
    job_id = job["id"]
    task_id = job["task_id"]
    user_id = job.get("user_id")  # Get user_id from job, will be updated from task if needed
    log(f"[job {job_id}] start task={task_id}")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Load task
            cur.execute("SELECT * FROM public.tasks WHERE id = %s", (task_id,))
            task = cur.fetchone()
            if not task:
                raise RuntimeError("Task not found")

            if task.get("task_type") not in (None, "marketing_audit"):
                log(f"[job {job_id}] skip non-marketing task_type={task.get('task_type')}")
                return
            
            # Update user_id from task if not in job
            if not user_id:
                user_id = task.get("user_id")

            # Load documents (exclude category='result')
            cur.execute(
                """
                SELECT * FROM public.documents
                WHERE task_id = %s AND (category IS NULL OR category <> 'result')
                """,
                (task_id,),
            )
            docs = [dict(r) for r in cur.fetchall()]
            if not docs:
                raise RuntimeError("No documents to process")

        stage = (job.get("stage") or "full").lower()

        cleaned_path, chunks = clean_documents(task, docs)

        # Только очистка — без векторизации
        if stage == "cleaning":
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.tasks
                    SET analysis_status = %s,
                        cleaned_data_path = COALESCE(%s, cleaned_data_path)
                    WHERE id = %s
                    """,
                    ("cleaned", cleaned_path, task_id),
                )
            log(f"[job {job_id}] cleaning done, cleaned_path={cleaned_path}")
            return

        # Полный цикл: анализ через Ollama
        if not chunks:
            raise RuntimeError("No text chunks after cleaning")

        # Собираем данные для анализа (ограничиваем размер контекста)
        data_for_analysis = []
        total_chars = 0
        max_context_chars = 12000  # ~3000 токенов для данных
        for ch in chunks:
            text = ch["chunk_text"]
            if total_chars + len(text) > max_context_chars:
                break
            data_for_analysis.append(text)
            total_chars += len(text)

        # Получаем инструкции: admin_prompt (от админа) + instructions (от пользователя)
        admin_prompt = task.get("admin_prompt") or ""
        user_instructions = task.get("instructions") or task.get("analysis_prompt") or ""
        combined_instructions = "\n\n".join(filter(None, [admin_prompt, user_instructions]))
        data_source = task.get("data_source") or "unknown"

        # Формируем промпт для анализа
        analysis_context = "\n".join(data_for_analysis)
        user_prompt = f"""ДАННЫЕ ДЛЯ АНАЛИЗА (источник: {data_source}):

{analysis_context}

---
ADDITIONAL INSTRUCTIONS:
{combined_instructions if combined_instructions else "No additional instructions."}

---
Проведи полный анализ данных согласно структуре. Дай конкретные рекомендации по оптимизации."""

        # Обновляем статус на "analyzing"
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE public.tasks SET analysis_status = 'analyzing' WHERE id = %s",
                (task_id,),
            )
        conn.commit()

        # Определяем провайдера LLM из job или task (по умолчанию gemini, т.к. Ollama удален)
        llm_provider = (job.get("llm_provider") or task.get("llm_provider") or "gemini").lower()
        
        log(f"[job {job_id}] starting analysis, provider={llm_provider}, data_chars={total_chars}, chunks={len(data_for_analysis)}")
        
        # Загружаем системный промпт из БД по data_source
        system_prompt = MARKETING_AUDIT_SYSTEM_PROMPT  # default fallback
        with conn.cursor() as cur:
            cur.execute(
                "SELECT prompt FROM public.system_prompts WHERE data_source = %s",
                (data_source,),
            )
            row = cur.fetchone()
            if row and row[0]:
                system_prompt = row[0]
                log(f"[job {job_id}] loaded system prompt for data_source={data_source}")
            else:
                log(f"[job {job_id}] using default system prompt (no custom for {data_source})")

        # Вызываем соответствующий LLM (только Gemini, Ollama удален)
        tokens_in, tokens_out = 0, 0
        llm_model = ""
        if "gemini" in llm_provider or not llm_provider or llm_provider == "local":
            # Используем Gemini по умолчанию (Ollama удален)
            if not GEMINI_API_KEY:
                raise RuntimeError("GEMINI_API_KEY not configured. Ollama has been removed, please use Gemini.")
            analysis_result, tokens_in, tokens_out = gemini_generate(user_prompt, system_prompt=system_prompt)
            llm_model = GEMINI_MODEL
        else:
            # Только Gemini поддерживается
            if not GEMINI_API_KEY:
                raise RuntimeError("GEMINI_API_KEY not configured. Only Gemini is supported.")
            analysis_result, tokens_in, tokens_out = gemini_generate(user_prompt, system_prompt=system_prompt)
            llm_model = GEMINI_MODEL

        # Save result file reference in documents table (inline storage in analysis_result field)
        result_filename = f"analysis_{int(time.time())}.md"
        result_path = "inline:analysis_result"  # Special path indicating inline storage
        
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.documents (task_id, user_id, filename, file_path, file_size, file_type, virus_status, category)
                VALUES (%s, %s, %s, %s, %s, 'document', 'clean', 'result')
                """,
                (task_id, user_id, result_filename, result_path, len(analysis_result)),
            )

        # Update task status to done
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.tasks
                SET status = 'done',
                    analysis_status = 'done',
                    analysis_result = %s,
                    cleaned_data_path = COALESCE(%s, cleaned_data_path),
                    tokens_input = COALESCE(tokens_input, 0) + %s,
                    tokens_output = COALESCE(tokens_output, 0) + %s,
                    llm_model = %s
                WHERE id = %s
                """,
                (analysis_result, cleaned_path, tokens_in, tokens_out, llm_model, task_id),
            )

        log(f"[job {job_id}] analysis done, result_len={len(analysis_result)}, tokens: in={tokens_in}, out={tokens_out}")
    finally:
        conn.close()


def main_loop() -> None:
    log("Marketing Audit processor started", {"SUPABASE_URL": SUPABASE_URL, "GEMINI_MODEL": GEMINI_MODEL})
    while True:
        try:
            job = claim_next_job()
            if not job:
                time.sleep(POLL_INTERVAL_SEC)
                continue
            try:
                process_job(job)
                finish_job(job["id"], "done")
            except Exception as e:
                log(f"[job {job['id']}] error: {e}")
                finish_job(job["id"], "error", str(e))
        except Exception as e:
            log("Loop error:", e)
            time.sleep(POLL_INTERVAL_SEC * 3)


if __name__ == "__main__":
  main_loop()


