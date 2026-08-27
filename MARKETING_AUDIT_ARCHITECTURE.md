# Marketing Audit: Архитектура и план реализации

## 📋 Текущее состояние

**Существующая инфраструктура:**
- ✅ Таблицы `tasks` и `documents` в Supabase
- ✅ Storage bucket `user_uploads` для файлов
- ✅ Админка с управлением задачами
- ✅ RLS политики для изоляции данных пользователей
- ✅ Индексатор для Chat Agent (можно переиспользовать паттерны)

## 🎯 Требования

### 1. Загрузка данных пользователем
- **Форматы:** CSV, XLSX, PDF, DOC, ссылки на Google Sheets
- **Типы данных:** Google ADS, Facebook ADS, Instagram ADS, Yandex Direct, TikTok ADS, Google Analytics, Yandex Metrika
- **Промпт:** Опциональный, с целями и пожеланиями
- **Кнопка "Analyse":** Запускает обработку

### 2. Обработка данных
- **Очистка на Python:** Уменьшение размера, кластеризация
- **Векторизация:** Эмбеддинги для RAG
- **Хранение:** Пользовательский Postgres (векторы + метаданные)

### 3. Админка
- **Просмотр файлов пользователя**
- **Выбор LLM:** Серверная LLM / Gemini / GLM (Bigmodel)
- **База знаний:** Загрузка для каждой платформы (ссылки + файлы)
- **Для Gemini:** База знаний как референс

## 🔍 Уточняющие вопросы

### Критичные:
1. **Пользовательский Postgres:**
   - Это отдельная БД на клиента или общая Supabase с изоляцией по `user_id`?
   - Нужны ли отдельные таблицы на пользователя или общие с `user_id`?

2. **Очистка файлов:**
   - Что конкретно означает "уменьшение размера"? (дедупликация, удаление пустых строк, агрегация?)
   - Какая кластеризация нужна? (по датам, кампаниям, метрикам?)

3. **Векторизация:**
   - Векторизуем весь файл целиком или по строкам/группам?
   - Нужны ли метаданные в векторах (дата, платформа, метрики)?

4. **Анализ:**
   - Что должен делать анализ? (выявление проблем, рекомендации, сравнение периодов?)
   - Нужен ли интерактивный режим (вопросы пользователя) или только отчет?

### Важные:
5. **Google Sheets:**
   - Как получать доступ? (OAuth токен пользователя или публичные ссылки?)
   - Нужна ли синхронизация или разовая загрузка?

6. **База знаний админа:**
   - Это общая для всех пользователей или можно настраивать под клиента?
   - Как часто обновляется?

7. **LLM выбор:**
   - Пользователь выбирает или только админ?
   - Нужна ли возможность сравнения результатов разных LLM?

## 🏗️ Предлагаемая архитектура

### Схема БД (Supabase)

```sql
-- Расширение tasks для Marketing Audit
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'marketing_audit';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS data_source TEXT; -- 'google_ads', 'facebook_ads', etc.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS analysis_prompt TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS llm_provider TEXT; -- 'local', 'gemini', 'glm'
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS analysis_status TEXT DEFAULT 'pending'; -- 'pending', 'cleaning', 'vectorizing', 'analyzing', 'done', 'error'
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS analysis_result JSONB; -- результаты анализа
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cleaned_data_path TEXT; -- путь к очищенным данным

-- Таблица для хранения векторизованных данных (в Supabase или отдельном Postgres)
CREATE TABLE IF NOT EXISTS public.marketing_audit_vectors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(384), -- или другой размер в зависимости от модели
  metadata JSONB, -- {date, campaign_id, metrics, etc.}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_marketing_audit_vectors_task ON public.marketing_audit_vectors(task_id);
CREATE INDEX idx_marketing_audit_vectors_user ON public.marketing_audit_vectors(user_id);
CREATE INDEX idx_marketing_audit_vectors_embedding ON public.marketing_audit_vectors USING ivfflat (embedding vector_cosine_ops);

-- База знаний админа для платформ
CREATE TABLE IF NOT EXISTS public.marketing_platform_kb (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL, -- 'google_ads', 'facebook_ads', etc.
  source_type TEXT NOT NULL, -- 'file', 'url'
  title TEXT,
  storage_path TEXT,
  url TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.marketing_platform_kb ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_platform_kb_admin_only" ON public.marketing_platform_kb
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Job'ы для обработки
CREATE TABLE IF NOT EXISTS public.marketing_audit_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  stage TEXT NOT NULL, -- 'cleaning', 'vectorizing', 'analyzing'
  status TEXT DEFAULT 'queued', -- 'queued', 'running', 'done', 'error'
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Компоненты системы

#### 1. **Frontend (React)**
- **TaskDetail.tsx** (расширение):
  - Выбор типа данных (dropdown)
  - Поле для промпта (textarea)
  - Кнопка "Analyse"
  - Отображение статуса обработки
  - Просмотр результатов анализа

- **AdminMarketingAudit.tsx** (новый):
  - Список задач пользователей
  - Выбор LLM для анализа
  - Загрузка базы знаний по платформам
  - Просмотр результатов

#### 2. **Backend обработки (Python)**

**Сервис: `marketing-audit-processor`**

**Этапы обработки:**

1. **Cleaning Stage:**
   - Парсинг CSV/XLSX/PDF/DOC
   - Дедупликация строк
   - Удаление пустых/невалидных данных
   - Нормализация форматов дат/валют
   - Агрегация по периодам (опционально)
   - Сохранение очищенных данных в Storage

2. **Vectorization Stage:**
   - Разбивка на чанки (по строкам или группам)
   - Генерация эмбеддингов (Ollama или внешний API)
   - Сохранение в `marketing_audit_vectors` с метаданными

3. **Analysis Stage:**
   - Загрузка базы знаний по платформе
   - RAG-поиск релевантных чанков
   - Генерация анализа через выбранный LLM
   - Сохранение результата в `tasks.analysis_result`

**Технологии:**
- Python 3.11+
- pandas для обработки данных
- openpyxl для XLSX
- pdfplumber для PDF
- python-docx для DOC
- gspread для Google Sheets (если нужен OAuth)
- pgvector для работы с векторами
- langchain для RAG (опционально)

#### 3. **LLM интеграции**

**Серверная LLM (Ollama):**
- Использует существующий Ollama
- Модель: qwen2.5:7b или аналогичная
- RAG через Chroma (можно переиспользовать коллекции)

**Gemini API:**
- Google Gemini API
- База знаний как референс (File API или Grounding)
- Streaming для больших ответов

**GLM (Bigmodel):**
- ZhipuAI API
- Аналогично Gemini

### Оптимизации

#### 1. **Кэширование очищенных данных**
- Сохранять очищенные файлы в Storage
- Переиспользовать при повторном анализе (если исходники не изменились)

#### 2. **Инкрементальная обработка**
- Обрабатывать только новые файлы в задаче
- Обновлять векторы только для измененных данных

#### 3. **Параллельная обработка**
- Обработка нескольких файлов параллельно
- Batch-обработка векторизации

#### 4. **Умная кластеризация**
- Группировка по датам/кампаниям автоматически
- Выявление аномалий на этапе очистки

#### 5. **Предпросмотр результатов**
- Показывать промежуточные результаты (статистика, графики)
- Stream результатов анализа (для Gemini/GLM)

## 📝 План реализации (MVP)

### Фаза 1: Базовая инфраструктура (1-2 дня)
1. Расширение схемы БД
2. Обновление UI для загрузки с типом данных
3. Добавление поля промпта

### Фаза 2: Очистка данных (2-3 дня)
1. Python сервис для парсинга файлов
2. Базовая очистка (дедупликация, валидация)
3. Сохранение очищенных данных

### Фаза 3: Векторизация (2-3 дня)
1. Чанкинг данных
2. Генерация эмбеддингов
3. Сохранение в pgvector

### Фаза 4: Анализ (3-4 дня)
1. RAG-поиск
2. Интеграция с серверной LLM
3. Генерация базового анализа

### Фаза 5: Админка и внешние LLM (2-3 дня)
1. UI для выбора LLM
2. Интеграция Gemini API
3. Интеграция GLM API
4. Загрузка базы знаний

**Итого MVP: ~10-15 дней разработки**

## 🚀 Следующие шаги

1. **Уточнить вопросы** (см. раздел выше)
2. **Создать детальный технический дизайн** для Python сервиса
3. **Начать с MVP:** Базовая очистка + серверная LLM
4. **Постепенно добавлять:** Внешние LLM, база знаний, оптимизации

## 💡 Дополнительные идеи

1. **Шаблоны промптов:** Предустановленные промпты для разных типов анализа
2. **Сравнение периодов:** Автоматическое сравнение с предыдущими периодами
3. **Визуализация:** Графики и дашборды в результатах
4. **Экспорт:** PDF/Excel отчеты с анализом
5. **Уведомления:** Email/Telegram когда анализ готов
6. **История:** Сохранение всех анализов для отслеживания изменений

