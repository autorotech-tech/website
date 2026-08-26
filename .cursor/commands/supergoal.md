---
name: supergoal
description: Plan and autonomously build a software task end-to-end. Adaptive phases, memory preload, 3-strike recovery. Usage: /supergoal <what to build or fix>
argument-hint: <describe what you want built, fixed, or shipped>
---

# /supergoal

Read and follow the **supergoal** skill (`supergoal/SKILL.md` in global or project skills).

The user's task is everything after `/supergoal` in this message.

## Cursor adaptation

Supergoal was written for Claude Code / Codex (`/goal` evaluator). In **Cursor Agent**:

1. Run Stages **0–6** exactly as in the skill (memory, recon, decompose, specs, plan review).
2. At **Stage 7**, do **not** wait for a `/goal` paste. After explicit plan approval, continue **in this same session**:
   - Execute phases sequentially from `$SUPERGOAL_ROOT/phases/phase-N.md`
   - Follow `$SUPERGOAL_ROOT/PROTOCOL.md` (3-strike retry → fix-spec → handoff)
   - Run `SUPERGOAL_PHASE_VERIFY` and `SUPERGOAL_PHASE_DONE` per phase in the transcript
   - Run the **final audit** before printing `SUPERGOAL_RUN_COMPLETE`
3. Locate scripts via `$SUPERGOAL_DIR` (symlinked under `~/.cursor/skills/skills/supergoal`, `~/.claude/skills/supergoal`, or `.agents/skills/supergoal`).

If the task is trivial (<1 hour, single file), say so and skip the full machinery.
