#!/usr/bin/env python3
"""HTTP bridge: agent-api → Cursor Agent CLI on the same host (or Mac).

POST /run  JSON: { "prompt", "workspace?", "cursor_mode?", "timeout_sec?" }
Auth: Authorization: Bearer <CURSOR_BRIDGE_TOKEN> or X-API-Key

Env:
  CURSOR_BRIDGE_TOKEN   required shared secret
  CURSOR_BRIDGE_HOST    default 127.0.0.1
  CURSOR_BRIDGE_PORT    default 8791
  CURSOR_API_KEY        passed through to agent CLI
  HERMES_CURSOR_CLI_CMD default: agent --print --output-format json
  HERMES_CURSOR_WORKSPACE  default cwd for --workspace
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse


def _env(name: str, default: str = "") -> str:
    return str(os.environ.get(name) or default).strip()


def _run_agent(prompt: str, workspace: str, cursor_mode: str, timeout_sec: int) -> Tuple[int, str, str, int]:
    base_cmd = _env("HERMES_CURSOR_CLI_CMD", "agent --print --output-format json")
    argv = shlex.split(base_cmd)
    if workspace:
        argv.extend(["--workspace", workspace])
    mode = (cursor_mode or "").strip().lower()
    if mode in {"plan", "ask"}:
        argv.extend(["--mode", mode])
    argv.append(prompt)

    env = os.environ.copy()
    api_key = _env("CURSOR_API_KEY")
    if api_key:
        env["CURSOR_API_KEY"] = api_key

    started = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=max(10, timeout_sec),
            check=False,
            env=env,
            cwd=workspace or None,
        )
    except FileNotFoundError:
        return 127, "", "Cursor agent binary not found in PATH (expected `agent`).", int((time.monotonic() - started) * 1000)
    except subprocess.TimeoutExpired:
        return 124, "", "Cursor agent timed out.", int((time.monotonic() - started) * 1000)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip(), elapsed_ms


def _parse_answer(stdout: str) -> str:
    if not stdout:
        return ""
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    for ln in reversed(lines):
        try:
            obj = json.loads(ln)
        except Exception:
            continue
        if isinstance(obj, dict):
            text = str(
                obj.get("text")
                or obj.get("content")
                or obj.get("output")
                or obj.get("response")
                or ""
            ).strip()
            if text:
                return text
    return stdout


class Handler(BaseHTTPRequestHandler):
    server_version = "AutoroCursorBridge/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _token_ok(self) -> bool:
        expected = _env("CURSOR_BRIDGE_TOKEN")
        if not expected:
            return False
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer ") and auth[7:].strip() == expected:
            return True
        key = self.headers.get("X-API-Key") or ""
        return key.strip() == expected

    def _send(self, code: int, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/", "/health"}:
            self._send(
                200,
                {
                    "ok": True,
                    "service": "cursor-cli-bridge",
                    "agent_cmd": _env("HERMES_CURSOR_CLI_CMD", "agent --print --output-format json"),
                    "has_cursor_api_key": bool(_env("CURSOR_API_KEY")),
                    "workspace": _env("HERMES_CURSOR_WORKSPACE"),
                },
            )
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/run":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._token_ok():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        try:
            body = json.loads(self.rfile.read(max(0, length)).decode("utf-8") or "{}")
        except Exception:
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        if not isinstance(body, dict):
            self._send(400, {"ok": False, "error": "body must be object"})
            return

        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self._send(400, {"ok": False, "error": "prompt is required"})
            return
        workspace = str(
            body.get("workspace")
            or body.get("cursor_workspace")
            or _env("HERMES_CURSOR_WORKSPACE")
            or ""
        ).strip()
        cursor_mode = str(body.get("cursor_mode") or body.get("mode") or "").strip().lower()
        try:
            timeout_sec = int(body.get("timeout_sec") or _env("HERMES_CURSOR_TIMEOUT_SEC", "240") or "240")
        except (TypeError, ValueError):
            timeout_sec = 240

        code, stdout, stderr, elapsed_ms = _run_agent(prompt, workspace, cursor_mode, timeout_sec)
        answer = _parse_answer(stdout)
        if code != 0:
            self._send(
                502,
                {
                    "ok": False,
                    "error": (stderr or stdout or f"exit {code}")[:800],
                    "exit_code": code,
                    "elapsed_ms": elapsed_ms,
                },
            )
            return
        if not answer:
            answer = "Cursor CLI completed with empty response."
        self._send(
            200,
            {
                "ok": True,
                "answer": answer,
                "elapsed_ms": elapsed_ms,
                "workspace": workspace,
                "cursor_mode": cursor_mode or None,
                "provider": "cursor_cli",
            },
        )


def main() -> None:
    if not _env("CURSOR_BRIDGE_TOKEN"):
        raise SystemExit("CURSOR_BRIDGE_TOKEN is required")
    host = _env("CURSOR_BRIDGE_HOST", "127.0.0.1")
    port = int(_env("CURSOR_BRIDGE_PORT", "8791") or "8791")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"cursor-cli-bridge listening on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
