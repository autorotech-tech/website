---
name: ai-engineering-coach
description: >-
  Agentic workflow coaching from autorotech-tech/AI-Engineering-Coach — anti-patterns,
  prompt quality, session hygiene, context management. Use when reviewing how the user
  works with AI, improving prompts, or after long agent sessions. Install extension via
  npm run ai-engineering-coach:install.
---

# AI Engineer Coach (autorotech fork)

Upstream: [autorotech-tech/AI-Engineering-Coach](https://github.com/autorotech-tech/AI-Engineering-Coach) (fork of Microsoft AI-Engineering-Coach).

**Extension (human):** read-only analytics dashboard in Cursor/VS Code — session logs, anti-pattern scores, rule editor. Zero telemetry.

**Skill (agent):** apply the same practice categories when helping the user code with AI.

## Install / update

```bash
npm run ai-engineering-coach:install
```

Opens: Command Palette → **AI Engineer Coach: Open Dashboard**.

Built-in rules live in the vendored repo: `.cursor/skills/_repos/ai-engineering-coach/src/core/rules/`.

## When to use

- User asks how to work better with Cursor / agents
- Long or drifting sessions; repeated prompts; vague requests
- Before large refactors — check file context and plan mode
- After shipping agent-generated code — encourage review, not blind accept

## Practice categories (mirror extension scoring)

### Prompt quality

- Reference concrete files (`@file`, open editors) — avoid **no-file-context**
- Specific intent, constraints, expected output — avoid **lazy-prompting**
- Stay professional; frustration hurts loop quality

### Session hygiene

- Split **mega-sessions**; close **abandoned** threads
- One topic per session — avoid **session-drift**
- Don't duplicate near-identical prompts (**repeated-prompts**)

### Code review

- Review diffs before accept — avoid **speed-accept** / **copy-paste-blindness**
- Don't auto-run risky terminal without sandbox (**auto-approve-terminal**, **yolo-mode**)

### Tool mastery

- Use slash commands, skills, and plan mode where appropriate
- Right-size model tier — avoid **premium-waste** on trivial lookups
- Prefer project skills (`AGENTS.md`, `.cursor/skills/`) over empty context

### Context management

- Watch context window growth; start fresh when **compaction** or **runaway-growth** patterns appear
- Trim verbose prompts; use progressive disclosure in skills

## Agent workflow

1. If extension is installed, suggest **Reload Data** then **Open Dashboard** for measured findings.
2. For live coaching without metrics, read relevant rule files under `src/core/rules/` in the vendored repo (e.g. `lazy-prompting.md`, `no-file-context.md`).
3. Give one **PROBLEM** + one **ACTION** per finding (same format as the extension UI).
4. Do not send session logs externally — extension is local-only.

## Cursor command

`/ai-engineering-coach` — open this skill and coach the user on their current workflow or last task.
