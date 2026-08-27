# Патч для DeerFlow: RotatingChatGoogleGenerativeAI + bind_tools.
# Копировать в backend/packages/harness/deerflow/models/rotating_gemini.py на сервере
# (или применить только метод bind_tools к существующему файлу).
#
# Симптом без патча: пустой ответ в UI, в логах langgraph:
#   NotImplementedError в langchain_core ... bind_tools
#   During task with name 'model'

import json
import threading
from typing import Any

from langchain.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatResult

try:
    from langchain_google_genai import ChatGoogleGenerativeAI
except Exception:  # pragma: no cover
    ChatGoogleGenerativeAI = None  # type: ignore


def _parse_keys(keys: Any) -> list[str]:
    if keys is None:
        return []
    if isinstance(keys, list):
        return [str(k).strip() for k in keys if str(k).strip()]
    if isinstance(keys, str):
        s = keys.strip()
        if not s:
            return []
        if s.startswith("[") and s.endswith("]"):
            try:
                arr = json.loads(s)
                if isinstance(arr, list):
                    return [str(k).strip() for k in arr if str(k).strip()]
            except Exception:
                pass
        return [p.strip() for p in s.split(",") if p.strip()]
    return [str(keys).strip()]


def _looks_retryable(e: Exception) -> bool:
    msg = str(e).lower()
    needles = [
        "api key not valid",
        "invalid api key",
        "permission",
        "quota",
        "exceeded",
        "rate limit",
        "429",
        "unauthorized",
        "401",
    ]
    return any(n in msg for n in needles)


class RotatingChatGoogleGenerativeAI(BaseChatModel):
    """ChatGoogleGenerativeAI wrapper with API key rotation.

    Config expects:
    - api_keys: JSON array string or list
    - model: gemini model name (e.g. gemini-2.5-flash)
    - other ChatGoogleGenerativeAI kwargs
    """

    def __init__(self, **kwargs: Any):
        super().__init__()
        keys_arg = kwargs.pop("api_keys", None)
        self._raw_kwargs = dict(kwargs)
        self._keys = _parse_keys(keys_arg)
        self._lock = threading.Lock()
        self._idx = 0
        if not self._keys:
            raise ValueError("RotatingChatGoogleGenerativeAI: no api_keys provided")

    @property
    def _llm_type(self) -> str:  # pragma: no cover
        return "rotating-gemini"

    def _client_for_key(self, key: str) -> Any:
        if ChatGoogleGenerativeAI is None:
            raise RuntimeError("langchain_google_genai is not available")
        kw = dict(self._raw_kwargs)
        kw["google_api_key"] = key
        return ChatGoogleGenerativeAI(**kw)

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any) -> ChatResult:
        last_err: Exception | None = None
        n = len(self._keys)
        with self._lock:
            start = self._idx
            self._idx = (self._idx + 1) % n
        for attempt in range(n):
            key = self._keys[(start + attempt) % n]
            try:
                client = self._client_for_key(key)
                return client._generate(messages, stop=stop, **kwargs)
            except Exception as e:  # noqa: BLE001
                last_err = e
                if not _looks_retryable(e):
                    raise
                continue
        assert last_err is not None
        raise last_err

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        """LangChain agents call bind_tools; BaseChatModel default raises NotImplementedError."""
        client = self._client_for_key(self._keys[0])
        return client.bind_tools(tools, **kwargs)

    async def _agenerate(self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any) -> ChatResult:
        last_err: Exception | None = None
        n = len(self._keys)
        with self._lock:
            start = self._idx
            self._idx = (self._idx + 1) % n
        for attempt in range(n):
            key = self._keys[(start + attempt) % n]
            try:
                client = self._client_for_key(key)
                return await client._agenerate(messages, stop=stop, **kwargs)
            except Exception as e:  # noqa: BLE001
                last_err = e
                if not _looks_retryable(e):
                    raise
                continue
        assert last_err is not None
        raise last_err
