---
name: ai-engineering-coach
description: Coach AI-assisted workflow using autorotech AI-Engineering-Coach anti-patterns. Usage: /ai-engineering-coach [topic]
argument-hint: <optional — prompt quality, session hygiene, context, review habits>
---

# /ai-engineering-coach

Read and follow **ai-engineering-coach** skill (`.cursor/skills/ai-engineering-coach/SKILL.md`).

The user's focus is everything after `/ai-engineering-coach` in this message (or general workflow review if empty).

1. If extension is installed, remind: Command Palette → **AI Engineer Coach: Open Dashboard** for scored findings.
2. Otherwise apply built-in rule categories from the skill and vendored rules in `.cursor/skills/_repos/ai-engineering-coach/src/core/rules/`.
3. Respond with concrete PROBLEM + ACTION items; keep advice local (no telemetry).

Install/update: `npm run ai-engineering-coach:install`
