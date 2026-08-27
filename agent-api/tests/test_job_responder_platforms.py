"""Tests for platform adapter registry."""

from __future__ import annotations

import job_responder_platforms as platforms


def test_hh_detect_t1():
    a = platforms.detect_platform("hh.ru")
    assert a.id == "hh"
    assert a.tier == 1
    assert a.supports_list_batch is True
    assert platforms.host_key_for_hostname("career.hh.ru") == "ru"
    assert platforms.host_key_for_hostname("hh.kz") == "kz"


def test_t2_board_detect():
    a = platforms.detect_platform("www.remote.co")
    assert a.id == "web"
    assert a.tier == 2
    assert "remote.co" in platforms.t2_board_domains()


def test_registry_list_and_labels():
    ids = {a.id for a in platforms.list_adapters()}
    assert "hh" in ids and "web" in ids
    assert platforms.get_adapter("hh") is platforms.HH_ADAPTER
    labels = platforms.host_labels()
    assert labels["ru"] == "hh.ru"
    assert "hh" in platforms.list_batch_ready_platforms()
