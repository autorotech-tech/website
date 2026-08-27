# Google Sheets schema

Создайте spreadsheet (имя: `Jobhunter HH`) с тремя листами. CSV-заголовки: [`sheets-templates/`](sheets-templates/).

## Sheet `vacancies`

| Колонка | Тип | Описание |
|---------|-----|----------|
| vacancy_id | string | ID HH |
| host | uz/kz/ru | Хост борда |
| url | url | alternate_url |
| title | string | Название |
| company | string | employer.name |
| company_url | url | сайт работодателя |
| published_at | ISO | published_at |
| employment_form | string | PROJECT / … |
| work_format | string | REMOTE / … |
| salary | string | сырой текст |
| snippet | string | короткий фрагмент JD |
| description_html | string | опционально full |
| contacts_email | string | из HH / preferred |
| contacts_phone | string | |
| preferred_contact | string | |
| hr_emails_found | string | `;`-separated с сайта |
| is_agency | bool | TRUE/FALSE |
| has_direct_path | bool | TRUE если email/phone |
| route | string | direct / hh_only / agency_skip |
| score | number | 0-100 |
| status | string | см. architecture |
| offer_variant | string | A / B |
| cover_letter | text | текст отклика HH |
| email_subject | string | |
| email_body | text | черновик прямого письма |
| approve | string | empty / YES / NO |
| error_code | string | |
| applied_at | ISO | |
| updated_at | ISO | |

Уникальный ключ: `vacancy_id` + `host`.

## Sheet `profile`

Одна рабочая строка (`active=TRUE`).

| Колонка | Пример |
|---------|--------|
| active | TRUE |
| full_name | Vladislav |
| roles | AI Solutions Architect; Product Marketing; Automation |
| stack | n8n, Playwright, OpenRouter, SEO/GEO, GoLogin |
| geo | Remote / Relocate |
| languages | ru, en |
| resume_url | https://autoro.tech/resume/ |
| resume_pdf_path | /path/or/drive/url.pdf |
| hh_resume_id_uz | (из GET /resumes/mine) |
| hh_resume_id_kz | |
| hh_resume_id_ru | |
| offer_tone | прямой, без AI-slop, фокус на результат |
| version | 2026-07-24 |

## Sheet `filters`

| Колонка | Пример стартовых значений |
|---------|---------------------------|
| host | uz |
| search_url | https://hh.uz/search/vacancy?employment_form=PROJECT&work_format=REMOTE |
| area_id | 97 |
| text | |
| employment_form | PROJECT |
| work_format | REMOTE |
| exclude_keywords | агентство;кадровое;ai recruiter;только бот;screening bot;рекрутинговое агентство |
| agency_employer_types | agency |
| min_score | 40 |
| daily_cap | 5 |
| auto_apply | FALSE |
| auto_email | FALSE |
| pause_on_block | TRUE |
| apify_fallback | TRUE |
| apify_actor_id | easyapi/hh-ru-job-scraper |
