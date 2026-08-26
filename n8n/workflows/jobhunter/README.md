# Jobhunter n8n workflow

## Import

1. n8n → Workflows → Import from File → `jobhunter_hh.json`
2. Create credentials:
   - Google Sheets OAuth2
   - (optional) HTTP Header Auth for Apify
3. Set env from `jobhunter.env.example` on the n8n host.
4. Update Execute Command paths to your `scripts/jobhunter` checkout.
5. Keep workflow **inactive** until dry-run on test HH account succeeds.

## Triggers

| Node | Purpose |
|------|---------|
| Manual Trigger | On-demand dry-run |
| Cron (every 6h) | Scheduled ingest → enrich → offer |
| Cron Apply (hourly) | Only rows with `approve=YES` |

## Branches

1. **Ingest** - run `cli.py pipeline` or `ingest` with filters from Sheets
2. **Upsert Sheets** - append new `host:vacancy_id`
3. **Human gate** - user sets `approve=YES` in Sheets
4. **Apply** - `cli.py apply --real` only if `auto_apply` and approve
5. **Pause** - on `blocked`/`captcha`/`rate_limit` stop apply branch

## Notes

- Google Sheets nodes in the JSON use placeholder `YOUR_SHEET_ID` - replace after creating spreadsheet from `docs/jobhunter/sheets-templates/`.
- Execute Command assumes repo mounted on the n8n server; alternatively call a small HTTP wrapper.
- Default `auto_apply=false`: apply cron is a no-op until filters + approve allow it.
