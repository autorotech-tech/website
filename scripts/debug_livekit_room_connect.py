#!/usr/bin/env python3
"""
Debug: LiveKit Room.connect state machine (CLI).
Requires: pip install "livekit~=1.0" (or livekit-agents which pulls rtc).

Usage:
  export LIVEKIT_URL="wss://..."
  export LIVEKIT_TOKEN="<jwt>"
  # optional:
  export DEBUG_RUN_ID=ru1
  export LIVEKIT_CONNECT_TIMEOUT_S=25
  export LIVEKIT_MEDIA_OBSERVE_S=10
  .venv-debug/bin/python3 scripts/debug_livekit_room_connect.py
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from pathlib import Path
from typing import Any

# region agent log
_DEBUG_LOG = Path(
    "/Users/vlad_x/Desktop/n8n/autoro.tech/website/.cursor/debug-b36587.log"
)
_SESSION = "b36587"


def _dbg(
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, Any] | None = None,
    *,
    run_id: str = "pre",
) -> None:
    payload = {
        "sessionId": _SESSION,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000),
    }
    try:
        _DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with _DEBUG_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError as e:
        print("debug log write failed:", e)


# endregion


def _jwt_payload_no_verify(token: str) -> dict[str, Any]:
    parts = token.strip().split(".")
    if len(parts) < 2:
        raise ValueError("not a JWT")
    pad = "=" * (-len(parts[1]) % 4)
    raw = base64.urlsafe_b64decode(parts[1] + pad)
    return json.loads(raw.decode("utf-8"))


async def _main() -> None:
    loop = asyncio.get_event_loop()
    url = os.getenv("LIVEKIT_URL", "").strip()
    tok = os.getenv("LIVEKIT_TOKEN", "").strip()
    run_id = os.getenv("DEBUG_RUN_ID", "pre").strip() or "pre"
    timeout_s = float(os.getenv("LIVEKIT_CONNECT_TIMEOUT_S", "25"))
    media_observe_s = float(os.getenv("LIVEKIT_MEDIA_OBSERVE_S", "10"))

    _dbg(
        "H-B",
        "debug_livekit_room_connect:start",
        "env snapshot (no secrets)",
        {
            "has_url": bool(url),
            "url_host_len": len(url),
            "token_len": len(tok),
            "timeout_s": timeout_s,
            "media_observe_s": media_observe_s,
        },
        run_id=run_id,
    )

    if not url or not tok:
        _dbg(
            "H-B",
            "debug_livekit_room_connect:missing_env",
            "LIVEKIT_URL or LIVEKIT_TOKEN empty",
            {},
            run_id=run_id,
        )
        raise SystemExit(2)

    try:
        claims = _jwt_payload_no_verify(tok)
        vid = claims.get("video") or {}
        exp = claims.get("exp")
        nbf = claims.get("nbf")
        now = int(time.time())
        _dbg(
            "H-B",
            "debug_livekit_room_connect:jwt_claims",
            "decoded JWT payload (no verify)",
            {
                "sub": claims.get("sub"),
                "room": vid.get("room"),
                "video_roomJoin": vid.get("roomJoin"),
                "nbf": nbf,
                "exp": exp,
                "skew_s": now - int(nbf) if nbf is not None else None,
                "ttl_s": int(exp) - now if exp is not None else None,
            },
            run_id=run_id,
        )
    except Exception as e:  # noqa: BLE001
        _dbg(
            "H-B",
            "debug_livekit_room_connect:jwt_decode_fail",
            str(e),
            {"err_type": type(e).__name__},
            run_id=run_id,
        )

    try:
        from livekit import rtc  # type: ignore
    except ImportError:
        _dbg(
            "H-E",
            "debug_livekit_room_connect:import_fail",
            "livekit rtc import failed; pip install livekit",
            {},
            run_id=run_id,
        )
        raise SystemExit(3) from None

    room = rtc.Room(loop=loop)
    counters: dict[str, int] = {
        "participant_connected": 0,
        "track_published": 0,
        "track_subscribed": 0,
        "track_subscription_failed": 0,
    }

    def _snapshot(label: str) -> None:
        remotes: list[dict[str, Any]] = []
        try:
            for _psid, rp in room.remote_participants.items():
                pubs: list[dict[str, Any]] = []
                for pub in rp.track_publications.values():
                    pubs.append(
                        {
                            "sid": pub.sid,
                            "name": pub.name,
                            "kind": int(pub.kind),
                            "muted": pub.muted,
                            "subscribed": getattr(pub, "subscribed", False),
                            "has_track": pub.track is not None,
                        }
                    )
                remotes.append(
                    {
                        "identity": rp.identity,
                        "name": rp.name,
                        "pub_count": len(pubs),
                        "publications": pubs,
                    }
                )
        except Exception as e:  # noqa: BLE001
            remotes = [{"error": f"{type(e).__name__}:{e!s}"[:200]}]

        lp = room.local_participant
        lp_pubs = []
        try:
            for pub in lp.track_publications.values():
                lp_pubs.append(
                    {
                        "sid": pub.sid,
                        "name": pub.name,
                        "kind": int(pub.kind),
                        "muted": pub.muted,
                    }
                )
        except Exception:
            lp_pubs = []

        _dbg(
            "H-MEDIA",
            f"debug_livekit_room_connect:snapshot:{label}",
            "room publications snapshot",
            {
                "remote_participant_count": len(room.remote_participants),
                "remotes": remotes,
                "local_publication_count": len(lp_pubs),
                "local_publications": lp_pubs,
                "event_counters": dict(counters),
            },
            run_id=run_id,
        )

    @room.on("connection_state_changed")  # type: ignore[misc]
    def _on_cs(state: Any) -> None:
        _dbg(
            "H-A",
            "debug_livekit_room_connect:connection_state_changed",
            "state changed",
            {"state": str(state)},
            run_id=run_id,
        )

    @room.on("connected")  # type: ignore[misc]
    def _on_conn() -> None:
        _dbg(
            "H-A",
            "debug_livekit_room_connect:connected_event",
            "room connected event fired",
            {},
            run_id=run_id,
        )

    @room.on("reconnecting")  # type: ignore[misc]
    def _on_reconn() -> None:
        _dbg(
            "H-A",
            "debug_livekit_room_connect:reconnecting",
            "reconnecting",
            {},
            run_id=run_id,
        )

    @room.on("disconnected")  # type: ignore[misc]
    def _on_disc() -> None:
        _dbg(
            "H-C",
            "debug_livekit_room_connect:disconnected",
            "room disconnected event",
            {},
            run_id=run_id,
        )

    @room.on("participant_connected")  # type: ignore[misc]
    def _on_pc(p: Any) -> None:
        counters["participant_connected"] += 1
        _dbg(
            "H-MEDIA",
            "debug_livekit_room_connect:participant_connected",
            "remote participant joined",
            {
                "identity": getattr(p, "identity", None),
                "name": getattr(p, "name", None),
                "n": counters["participant_connected"],
            },
            run_id=run_id,
        )

    @room.on("track_published")  # type: ignore[misc]
    def _on_tp(pub: Any, p: Any) -> None:
        counters["track_published"] += 1
        _dbg(
            "H-MEDIA",
            "debug_livekit_room_connect:track_published",
            "remote track published",
            {
                "participant": getattr(p, "identity", None),
                "pub_sid": getattr(pub, "sid", None),
                "kind": int(getattr(pub, "kind", 0)),
                "name": getattr(pub, "name", None),
                "n": counters["track_published"],
            },
            run_id=run_id,
        )

    @room.on("track_subscribed")  # type: ignore[misc]
    def _on_ts(track: Any, pub: Any, p: Any) -> None:
        counters["track_subscribed"] += 1
        _dbg(
            "H-MEDIA",
            "debug_livekit_room_connect:track_subscribed",
            "subscribed to remote track",
            {
                "participant": getattr(p, "identity", None),
                "pub_sid": getattr(pub, "sid", None),
                "track_sid": getattr(track, "sid", None),
                "kind": int(getattr(track, "kind", 0)),
                "n": counters["track_subscribed"],
            },
            run_id=run_id,
        )

    @room.on("track_subscription_failed")  # type: ignore[misc]
    def _on_tsf(p: Any, track_sid: Any, err: Any) -> None:
        counters["track_subscription_failed"] += 1
        _dbg(
            "H-MEDIA",
            "debug_livekit_room_connect:track_subscription_failed",
            "track subscription failed",
            {
                "participant": getattr(p, "identity", None),
                "track_sid": str(track_sid),
                "err": str(err)[:300],
                "n": counters["track_subscription_failed"],
            },
            run_id=run_id,
        )

    _dbg(
        "H-A",
        "debug_livekit_room_connect:before_connect",
        "calling room.connect",
        {},
        run_id=run_id,
    )
    t0 = time.perf_counter()

    async def _do_connect() -> None:
        await room.connect(url, tok)
        _dbg(
            "H-A",
            "debug_livekit_room_connect:after_connect_await",
            "room.connect awaited returned",
            {"elapsed_ms": int((time.perf_counter() - t0) * 1000)},
            run_id=run_id,
        )

    connect_ok = False
    try:
        await asyncio.wait_for(_do_connect(), timeout=timeout_s)
        connect_ok = True
    except asyncio.TimeoutError:
        _dbg(
            "H-A",
            "debug_livekit_room_connect:connect_timeout",
            f"still connecting after {timeout_s}s",
            {"elapsed_ms": int((time.perf_counter() - t0) * 1000)},
            run_id=run_id,
        )
    except Exception as e:  # noqa: BLE001
        _dbg(
            "H-D",
            "debug_livekit_room_connect:connect_error",
            "connect raised",
            {"err_type": type(e).__name__, "err": str(e)[:500]},
            run_id=run_id,
        )
    finally:
        if connect_ok:
            _snapshot("after_connect_before_wait")
            _dbg(
                "H-MEDIA",
                "debug_livekit_room_connect:media_wait",
                f"waiting {media_observe_s}s for tracks",
                {},
                run_id=run_id,
            )
            await asyncio.sleep(media_observe_s)
            _snapshot("after_media_wait")

        _dbg(
            "H-A",
            "debug_livekit_room_connect:disconnecting",
            "room.disconnect cleanup",
            {},
            run_id=run_id,
        )
        await room.disconnect()
        _dbg(
            "H-A",
            "debug_livekit_room_connect:exit",
            "script end",
            {"total_ms": int((time.perf_counter() - t0) * 1000)},
            run_id=run_id,
        )


if __name__ == "__main__":
    asyncio.run(_main())
