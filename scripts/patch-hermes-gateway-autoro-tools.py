#!/usr/bin/env python3
"""Вставить load_autoro_tools() в gateway/run.py сразу после discover_plugins()."""

from __future__ import annotations

import sys
from pathlib import Path


def patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "load_autoro_tools()" in text:
        print("Already patched:", path)
        return False

    needle = "            discover_plugins()\n        except Exception:"
    insert = """            discover_plugins()
            try:
                from tools.load_autoro_tools import load_autoro_tools

                _autoro_loaded = load_autoro_tools()
                if _autoro_loaded:
                    logger.info("Loaded Autoro tools: %s", ", ".join(_autoro_loaded))
            except Exception:
                logger.warning("Autoro tools load failed", exc_info=True)
        except Exception:"""

    if needle not in text:
        print("WARN: discover_plugins anchor not found in", path, file=sys.stderr)
        return False

    path.write_text(text.replace(needle, insert, 1), encoding="utf-8")
    print("Patched Autoro tools loader:", path)
    return True


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes-agent/gateway/run.py")
    if not target.is_file():
        sys.exit(1)
    patch(target)
