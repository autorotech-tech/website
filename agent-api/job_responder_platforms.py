"""Platform adapter registry for Autoro Hunt (T1 hh.* + T2 job boards).

Server-side mirror of extension platforms/* — host detection, list-batch readiness.
Does not replace extension extractors; elevates shared host metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence


@dataclass(frozen=True)
class PlatformAdapter:
    """Minimal adapter descriptor for vacancy extract / list-batch."""

    id: str
    tier: int  # 1 = hh family (full extract), 2 = generic job boards
    host_keys: Sequence[str]  # API host field values: ru|kz|uz|web
    domains: Sequence[str]
    label: str
    supports_list_batch: bool = False
    supports_cover_letter: bool = True
    selectors: Dict[str, str] = field(default_factory=dict)


# T1: HeadHunter family — full vacancy + response popup extract (extension page-extract.js).
HH_ADAPTER = PlatformAdapter(
    id="hh",
    tier=1,
    host_keys=("ru", "kz", "uz"),
    domains=("hh.ru", "hh.kz", "hh.uz"),
    label="HeadHunter",
    supports_list_batch=True,
    supports_cover_letter=True,
    selectors={
        "letter": '[data-qa="vacancy-response-popup-form-letter-input"]',
        "form_field": '[data-qa="vacancy-response-popup-form-field"]',
        "vacancy_title": '[data-qa="vacancy-title"]',
    },
)

# T2: known job boards — generic extract + list-batch readiness (no HH popup selectors).
_T2_BOARD_DOMAINS: Sequence[str] = (
    "remote.co",
    "getmatch.ru",
    "finder.work",
    "relocate.me",
    "cryptojobslist.com",
    "web3.career",
    "workingnomads.com",
    "aijobs.net",
    "simplyhired.com",
    "jobgether.com",
    "flexjobs.com",
    "powertofly.com",
    "crossover.com",
    "justremote.co",
    "foorilla.com",
    "instahyre.com",
)

WEB_ADAPTER = PlatformAdapter(
    id="web",
    tier=2,
    host_keys=("web",),
    domains=_T2_BOARD_DOMAINS,
    label="Generic job board / web",
    supports_list_batch=True,
    supports_cover_letter=True,
    selectors={},
)

_REGISTRY: Dict[str, PlatformAdapter] = {
    HH_ADAPTER.id: HH_ADAPTER,
    WEB_ADAPTER.id: WEB_ADAPTER,
}


def register_adapter(adapter: PlatformAdapter, *, overwrite: bool = False) -> None:
    if adapter.id in _REGISTRY and not overwrite:
        raise ValueError(f"adapter already registered: {adapter.id}")
    _REGISTRY[adapter.id] = adapter


def get_adapter(adapter_id: str) -> Optional[PlatformAdapter]:
    return _REGISTRY.get(adapter_id)


def list_adapters() -> List[PlatformAdapter]:
    return list(_REGISTRY.values())


def detect_platform(hostname: str) -> PlatformAdapter:
    """Map hostname -> adapter (hh T1 first, then T2 boards, else web)."""
    host = (hostname or "").lower().strip().lstrip(".")
    if host.startswith("www."):
        host = host[4:]
    for key, pattern_host in (("ru", "hh.ru"), ("kz", "hh.kz"), ("uz", "hh.uz")):
        if host == pattern_host or host.endswith("." + pattern_host):
            return HH_ADAPTER
    for domain in _T2_BOARD_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return WEB_ADAPTER
    return WEB_ADAPTER


def host_key_for_hostname(hostname: str) -> str:
    host = (hostname or "").lower().strip()
    if host.endswith("hh.ru") or ".hh.ru" in host:
        return "ru"
    if host.endswith("hh.kz") or ".hh.kz" in host:
        return "kz"
    if host.endswith("hh.uz") or ".hh.uz" in host:
        return "uz"
    return "web"


def host_labels() -> Dict[str, str]:
    """Canonical HOST_LABELS for generate prompts."""
    return {"ru": "hh.ru", "kz": "hh.kz", "uz": "hh.uz", "web": "web"}


def t2_board_domains() -> List[str]:
    return list(_T2_BOARD_DOMAINS)


def list_batch_ready_platforms() -> List[str]:
    return [a.id for a in _REGISTRY.values() if a.supports_list_batch]
