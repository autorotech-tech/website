#!/usr/bin/env python3
"""Патч Hermes gateway/run.py: не слать «Gateway shutting down» при обычном stop/restart контейнера."""

from __future__ import annotations

import sys
from pathlib import Path


def patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    needle_fn = "    async def _notify_active_sessions_of_shutdown(self) -> None:"
    insert = """    async def _notify_active_sessions_of_shutdown(self) -> None:
        \"\"\"Send shutdown/restart notifications to active chats and home channels.

        Called at the very start of stop() — adapters are still connected so
        messages can be delivered. Best-effort: individual send failures are
        logged and swallowed so they never block the shutdown sequence.
        \"\"\"
        # Autoro: не уведомлять при обычном shutdown (docker stop/restart).
        if not self._restart_requested:
            logger.debug("Skipping shutdown chat notifications (not an in-process gateway restart)")
            return

        active = self._snapshot_running_agents()"""

    if "Skipping shutdown chat notifications" not in text:
        old_block = """    async def _notify_active_sessions_of_shutdown(self) -> None:
        \"\"\"Send shutdown/restart notifications to active chats and home channels.

        Called at the very start of stop() — adapters are still connected so
        messages can be delivered. Best-effort: individual send failures are
        logged and swallowed so they never block the shutdown sequence.
        \"\"\"
        active = self._snapshot_running_agents()"""
        if old_block in text:
            text = text.replace(old_block, insert, 1)
        else:
            print("WARN: could not insert early-return block (block mismatch)", file=sys.stderr)

    text = text.replace(
        "if platform_cfg is not None and not platform_cfg.gateway_restart_notification:",
        "if platform_cfg is None or not platform_cfg.gateway_restart_notification:",
    )

    if text == original:
        print("No changes applied (already patched?)")
        return False
    path.write_text(text, encoding="utf-8")
    print(f"Patched {path}")
    return True


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes-agent/gateway/run.py")
    if not target.is_file():
        print(f"Missing {target}", file=sys.stderr)
        sys.exit(1)
    patch(target)
